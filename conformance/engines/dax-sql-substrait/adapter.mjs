// dax-sql's query plan as Substrait, run on DataFusion: each query's optimized plan written as a
// Substrait plan (substrait.js, its JSON form) and executed by DataFusion's Substrait consumer
// (run.py), over the suite's data written to Parquet by DuckDB (db.mjs), so both hold the same
// values of the same types. An engine that never sees dax-sql's SQL answers from the plan alone.
// Definitions are written where they are read (inline: DataFusion reads one relation tree only).
//
//   pip install -r engines/dax-sql-substrait/requirements.txt
//   node runner/run.mjs --adapter "node engines/dax-sql-substrait/adapter.mjs .." --known engines/dax-sql-substrait/known.json
//
// SUBSTRAIT_CORRELATED=1: the plan before decorrelation (scalar subqueries, EXISTS, outer references).
// SUBSTRAIT_UNNEST=1: that plan unnested (src/passes/unnest.js: no apply, no correlated EXISTS).
// SUBSTRAIT_PYTHON: the Python to run run.py with (python). SUBSTRAIT_OUT: a folder to keep each
// query's plan in (<id>.json), with dax.json: the dax-sql functions each plan uses.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { engine } from '../dax-sql/db.mjs';

const e = await engine(process.argv[2]);
const request = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'dax-substrait-'));
const keep = process.env.SUBSTRAIT_OUT;
if (keep) mkdirSync(keep, { recursive: true });
const ident = s => `"${String(s).replace(/"/g, '""')}"`;
// DuckDB's type as Substrait's kind.
const kind = t => {
  const s = String(t).toUpperCase(), m = /^DECIMAL\((\d+),\s*(\d+)\)$/.exec(s);
  if (m) return `decimal(${m[1]},${m[2]})`;
  if (/^(BIGINT|INTEGER|SMALLINT|TINYINT|HUGEINT|UBIGINT|UINTEGER)$/.test(s)) return 'i64';
  if (/^(DOUBLE|FLOAT|REAL)$/.test(s)) return 'fp64';
  if (s === 'BOOLEAN') return 'bool';
  if (s === 'DATE') return 'date';
  if (s.startsWith('TIMESTAMP')) return 'timestamp';
  return 'string';
};

const models = {}, jobs = [], dax = {}, answers = new Map();
const dbs = new Map();
for (const q of request.queries) {
  try {
    const key = `${q.model}|${q.data}`;
    if (!dbs.has(key)) {
      const db = await e.database(q.model, q.data);
      const name = `m${dbs.size}`, dir = join(work, name), tables = {}, schemas = new Map();
      mkdirSync(dir);
      for (const t of db.bim.model.tables) {
        const s = t.partitions?.[0]?.source;
        if (s?.type !== 'entity') continue;
        const cols = (await db.con.runAndReadAll(`DESCRIBE ${ident(s.entityName)}`)).getRowsJS().map(r => ({ name: r[0], type: kind(r[1]) }));
        // DuckDB's integers as BIGINT, its decimals as they are: the plan's i64.
        const sel = cols.map(c => (c.type === 'i64' ? `CAST(${ident(c.name)} AS BIGINT) AS ${ident(c.name)}` : ident(c.name))).join(', ');
        const path = join(dir, `${s.entityName}.parquet`).replace(/\\/g, '/');
        await db.con.run(`COPY (SELECT ${sel} FROM ${ident(s.entityName)}) TO '${path}' (FORMAT parquet)`);
        tables[s.entityName] = path;
        schemas.set(s.entityName, cols);
      }
      models[name] = tables;
      dbs.set(key, { ...db, name, schemas, compilers: new Map() });
    }
    const db = dbs.get(key);
    const roles = JSON.stringify(q.roles ?? null);
    if (!db.compilers.has(roles)) db.compilers.set(roles, e.createCompiler(db.model, { columnNames: 'dax', ...(q.roles ? { roles: q.roles } : {}) }));
    const c = db.compilers.get(roles);
    const entity = t => t.source?.entity ?? t.name;
    const t0 = performance.now();
    const { plan, dax: fns, columns } = c.substrait(q.dax, { tableName: entity, tableSchema: t => db.schemas.get(entity(t)), inline: true, correlated: !!process.env.SUBSTRAIT_CORRELATED, unnest: !!process.env.SUBSTRAIT_UNNEST });
    const ms = performance.now() - t0;
    if (ms > 5000) process.stderr.write(`${q.id}: its plan took ${Math.round(ms / 1000)} s to write\n`);
    const file = join(work, `q${jobs.length}.json`);
    writeFileSync(file, JSON.stringify(plan));
    if (keep) { const out = join(keep, `${q.id}.json`); mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(plan, null, 1)); }
    dax[q.id] = fns;
    jobs.push({ id: q.id, model: db.name, plan: file, columns: columns.map(x => x.name) });
  } catch (err) {
    answers.set(q.id, { id: q.id, error: `${err.code ? `${err.code}: ` : ''}${err.message.split('\n')[0]}`, ...(err.code === 'UNSUPPORTED' ? { unsupported: true } : {}) });
  }
}
if (keep) writeFileSync(join(keep, 'dax.json'), JSON.stringify(dax, null, 1));
// run.py ends at a query past its time (exit code 3, that query answered as timed out), or
// DataFusion ends it (a crash: the query it was on, the first with no answer, answered so): the
// queries still without an answer are run again, by a new process.
const jobsFile = join(work, 'jobs.json');
let left = jobs;
while (left.length) {
  writeFileSync(jobsFile, JSON.stringify({ models, queries: left }));
  const run = spawnSync(process.env.SUBSTRAIT_PYTHON || 'python', [join(dirname(fileURLToPath(import.meta.url)), 'run.py'), jobsFile], { encoding: 'utf8', maxBuffer: 1 << 30 });
  if (run.status !== 0 && run.status !== 3) process.stderr.write(run.stderr ?? '');
  for (const line of (run.stdout ?? '').split('\n').filter(Boolean)) {
    const a = JSON.parse(line), job = jobs.find(j => j.id === a.id);
    answers.set(a.id, a.error ? a : { id: a.id, columns: job.columns, rows: a.rows });
    if (/^timeout/.test(a.error ?? '')) process.stderr.write(`${a.id}: ${a.error}\n`);
  }
  if (run.status === 0) break;
  const at = left.find(j => !answers.has(j.id));
  if (!at) break;
  if (run.status !== 3) {
    const error = `crash: DataFusion ended (${run.signal ?? `exit code ${run.status}`}) on this plan`;
    answers.set(at.id, { id: at.id, error });
    process.stderr.write(`${at.id}: ${error}\n`);
  }
  left = left.filter(j => !answers.has(j.id));
}
for (const q of request.queries) process.stdout.write(`${JSON.stringify(answers.get(q.id) ?? { id: q.id, error: 'no answer from DataFusion' })}\n`);
