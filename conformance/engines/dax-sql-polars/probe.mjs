// How much of the suite's SQL Polars runs: each query compiled with the postgres dialect (its SQL
// is the nearest to what Polars reads), `AS [NOT] MATERIALIZED` taken out, run on Polars
// (worker.py) and compared with DuckDB's answer to the query, as bags of rows with numbers to
// 1e-6. Not a conformance run: no goldens, no known list; a measure of the gaps, in markdown.
//   PY=<python with polars> node conformance/engines/dax-sql-polars/probe.mjs
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadQueries, modelDir } from '../../tools/suite.mjs';
import { engine, value } from '../dax-sql/db.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PY = process.env.PY || 'python';
const TIMEOUT_MS = Number(process.env.POLARS_TIMEOUT_MS || 20000);

function worker(dir, name) {
  const p = spawn(PY, [join(here, 'worker.py'), dir, name], { stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = [];
  createInterface({ input: p.stdout }).on('line', l => waiting.shift()?.(JSON.parse(l)));
  const ask = (msg, ms) => new Promise(done => {
    const t = setTimeout(() => done({ timeout: true }), ms);
    waiting.push(v => { clearTimeout(t); done(v); });
    if (msg) p.stdin.write(JSON.stringify(msg) + '\n');
  });
  return { p, ask };
}

const norm = v => {
  if (v == null) return '∅';
  if (typeof v === 'boolean') return v ? '1' : '0';
  const n = Number(v);
  if (v !== '' && !Number.isNaN(n)) return String(Math.round(n * 1e6) / 1e6);
  return String(v).replace(/[T ]00:00:00$/, '').replace('T', ' ');
};
const bag = rows => rows.map(r => r.map(norm).join('|')).sort().join('\n');
const group = m => m.replace(/Query \{.*/, '').replace(/(Line|Column): \d+/g, '$1 …')
  .replace(/(unsupported function '[^']*'|`[A-Z ]+` clause)|'[^']*'|"[^"]*"|\d+/g, (x, keep) => keep ?? '…').slice(0, 120);

const e = await engine(resolve(here, '../../..'));
const queries = loadQueries({}).map(q => ({ ...q, key: `${q.model}/${q.family}/${q.id}` }));
const models = [...new Set(queries.map(q => q.model))];
const counts = {}, errors = new Map();
const count = k => { counts[k] = (counts[k] ?? 0) + 1; };

for (const model of models) {
  const dir = modelDir(model);
  const db = await e.database(join(dir, 'model.bim'), join(dir, 'data'));
  const source = t => `"${model}__${t.source?.entity ?? t.name}"`;
  const compilers = new Map();
  const compiler = (dialect, roles) => {
    const k = `${dialect}${JSON.stringify(roles ?? null)}`;
    if (!compilers.has(k)) compilers.set(k, e.createCompiler(db.model, {
      columnNames: 'dax', ...(dialect ? { dialect, tableSource: source } : {}), ...(roles ? { roles } : {}) }));
    return compilers.get(k);
  };
  let w = worker(dir, model);
  if (!(await w.ask(null, 300000)).ready) throw new Error(`no Polars worker for ${model}`);
  for (const q of queries.filter(x => x.model === model)) {
    let sql;
    try { sql = compiler('postgres', q.roles).compile(q.dax).sql.replace(/\bAS (NOT )?MATERIALIZED \(/g, 'AS ('); } catch { count('compile error'); continue; }
    let want = null;
    try { want = (await db.con.runAndReadAll(compiler(null, q.roles).compile(q.dax).sql)).getRowsJS().map(r => r.map(value)); } catch { }
    const got = await w.ask({ sql }, TIMEOUT_MS);
    if (got.timeout) {
      count('timeout');
      w.p.kill();
      w = worker(dir, model);
      await w.ask(null, 300000);
      continue;
    }
    if (got.error) {
      count('Polars error');
      const k = group(got.error), g = errors.get(k) ?? { n: 0, example: q.key };
      g.n++;
      errors.set(k, g);
      continue;
    }
    if (!want) { count('runs (DuckDB errs)'); continue; }
    count(bag(got.rows) === bag(want) ? 'agrees with DuckDB' : 'different answer');
  }
  w.p.kill();
}

const lines = [`### The suite's SQL (postgres dialect) on Polars ${process.env.POLARS_LABEL ?? ''}`, '',
  `${queries.length} queries.`, '', '| outcome | queries |', '|---|---|',
  ...Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `| ${k} | ${n} |`), '',
  '| Polars error | queries | e.g. |', '|---|---|---|',
  ...[...errors.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 30)
    .map(([k, g]) => `| ${k.replace(/\|/g, '\\|')} | ${g.n} | ${g.example} |`), ''];
console.log(lines.join('\n'));
