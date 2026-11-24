// dax-sql's adapter for Polars: as engines/dax-sql/adapter.mjs, but each query is compiled with
// the `polars` dialect through the query plan unnested (planSql { unnest: true }: Polars SQL has
// no LATERAL, and reads no outer row through a derived table) and run on Polars' SQLContext over
// the model's CSVs (worker.py, one process for each model).
//
//   PY=<python with polars> node engines/dax-sql-polars/adapter.mjs <dax-sql checkout> <request.json>
//
// POLARS_PLAN=correlated: the plan correlated instead (planSql { correlated: true }), for Polars
// to unnest its correlated subqueries itself, as Polars main does: a measure of it.
// POLARS_TIMEOUT_MS: a query's time (30 s); past it the worker is stopped and another started.
// DAXSQL_TIMES: each query's time (ms), to that file.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2]);
const { createCompiler } = await import(pathToFileURL(join(root, 'src', 'index.js')));
const { tmslToModel } = await import(pathToFileURL(join(root, 'formats', 'tmsl.js')));
const PY = process.env.PY || 'python';
const TIMEOUT_MS = Number(process.env.POLARS_TIMEOUT_MS || 30000);
const PLAN = process.env.POLARS_PLAN === 'correlated' ? { correlated: true } : { unnest: true };

function worker(dir, name) {
  const p = spawn(PY, [join(here, 'worker.py'), dir, name], { stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = [];
  createInterface({ input: p.stdout }).on('line', l => waiting.shift()?.(JSON.parse(l)));
  p.on('exit', () => { while (waiting.length) waiting.shift()({ error: 'the Polars worker ended' }); });
  const ask = (msg, ms) => new Promise(done => {
    const t = setTimeout(() => done({ timeout: true }), ms);
    waiting.push(v => { clearTimeout(t); done(v); });
    if (msg) p.stdin.write(JSON.stringify(msg) + '\n');
  });
  return { p, ask };
}

const request = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const times = [];
const byModel = new Map();
for (const q of request.queries) {
  if (!byModel.has(q.model)) byModel.set(q.model, []);
  byModel.get(q.model).push(q);
}
const out = a => process.stdout.write(`${JSON.stringify(a)}\n`);
const failed = (q, err) => out({ id: q.id, error: `${err.code ? `${err.code}: ` : ''}${String(err.message ?? err).split('\n')[0]}`, ...(err.code === 'UNSUPPORTED' ? { unsupported: true } : {}) });

for (const [modelPath, qs] of byModel) {
  const dir = dirname(modelPath), name = basename(dir);
  let bim;
  try { bim = JSON.parse(readFileSync(modelPath, 'utf8').replace(/^﻿/, '')); } catch (err) { qs.forEach(q => failed(q, err)); continue; }
  const model = tmslToModel(bim);
  const source = t => `"${name}__${t.source?.entity ?? t.name}"`;
  const compilers = new Map();
  const compiler = roles => {
    const k = JSON.stringify(roles ?? null);
    if (!compilers.has(k)) compilers.set(k, createCompiler(model, { dialect: 'polars', columnNames: 'dax', tableSource: source, ...(roles ? { roles } : {}) }));
    return compilers.get(k);
  };
  let w = worker(dir, name);
  const ready = await w.ask(null, 300000);
  if (!ready.ready) { qs.forEach(q => failed(q, new Error(`no Polars worker for ${name}`))); w.p.kill(); continue; }
  for (const q of qs) {
    let sql, columns;
    try { ({ sql, columns } = compiler(q.roles).planSql(q.dax, PLAN)); } catch (err) { failed(q, err); continue; }
    const t0 = performance.now();
    const got = await w.ask({ sql }, TIMEOUT_MS);
    if (got.timeout) {
      failed(q, new Error(`timeout: past ${TIMEOUT_MS / 1000} s`));
      w.p.kill();
      w = worker(dir, name);
      await w.ask(null, 300000);
      continue;
    }
    times.push({ id: q.id, ms: Math.round(performance.now() - t0), bytes: sql.length, ...(/\bLATERAL\b/.test(sql) ? { lateral: true } : {}) });
    if (got.error) { failed(q, new Error(got.error)); continue; }
    out({ id: q.id, columns: columns.map(c => c.name), rows: got.rows });
  }
  w.p.stdin.end();
}
if (process.env.DAXSQL_TIMES) writeFileSync(process.env.DAXSQL_TIMES, JSON.stringify(times.sort((a, b) => b.ms - a.ms), null, 1));
