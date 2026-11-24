// dax-sql on Apache DataFusion: each query compiled with the `datafusion` dialect through the
// query plan unnested (planSql { unnest: true }: its SQL written from the plan as Substrait,
// read back) and run by DataFusion (run.py), over the suite's data written to Parquet by DuckDB
// (db.mjs), so both hold the same values of the same types.
//
//   pip install -r engines/dax-sql-datafusion/requirements.txt
//   node runner/run.mjs --adapter "node engines/dax-sql-datafusion/adapter.mjs .." --known engines/dax-sql-datafusion/known.json
//
// DATAFUSION_PYTHON: the Python to run run.py with (python). DAXSQL_TIMES: each query's time
// (ms) to that file.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { engine } from '../dax-sql/db.mjs';

const e = await engine(process.argv[2]);
const request = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'dax-datafusion-'));
const ident = s => `"${String(s).replace(/"/g, '""')}"`;

const models = {}, jobs = [], answers = new Map();
const dbs = new Map();
for (const q of request.queries) {
  try {
    const key = `${q.model}|${q.data}`;
    if (!dbs.has(key)) {
      const db = await e.database(q.model, q.data);
      const name = `m${dbs.size}`, dir = join(work, name), tables = {};
      mkdirSync(dir);
      for (const t of db.bim.model.tables) {
        const s = t.partitions?.[0]?.source;
        if (s?.type !== 'entity') continue;
        const cols = (await db.con.runAndReadAll(`DESCRIBE ${ident(s.entityName)}`)).getRowsJS().map(r => ({ name: r[0], type: String(r[1]) }));
        // DuckDB's integers as BIGINT, the plan's whole numbers.
        const sel = cols.map(c => (/^(INTEGER|SMALLINT|TINYINT|HUGEINT|UBIGINT|UINTEGER)$/.test(c.type) ? `CAST(${ident(c.name)} AS BIGINT) AS ${ident(c.name)}` : ident(c.name))).join(', ');
        const path = join(dir, `${s.entityName}.parquet`).replace(/\\/g, '/');
        await db.con.run(`COPY (SELECT ${sel} FROM ${ident(s.entityName)}) TO '${path}' (FORMAT parquet)`);
        tables[s.entityName] = path;
      }
      models[name] = tables;
      dbs.set(key, { ...db, name, compilers: new Map() });
    }
    const db = dbs.get(key);
    const roles = JSON.stringify(q.roles ?? null);
    if (!db.compilers.has(roles)) db.compilers.set(roles, e.createCompiler(db.model, { dialect: 'datafusion', columnNames: 'dax', tableSource: t => ident(t.source?.entity ?? t.name), ...(q.roles ? { roles: q.roles } : {}) }));
    const { sql, columns } = db.compilers.get(roles).planSql(q.dax, { unnest: true });
    jobs.push({ id: q.id, model: db.name, sql, columns: columns.map(x => x.name) });
  } catch (err) {
    answers.set(q.id, { id: q.id, error: `${err.code ? `${err.code}: ` : ''}${err.message.split('\n')[0]}`, ...(err.code === 'UNSUPPORTED' ? { unsupported: true } : {}) });
  }
}
// run.py ends at a query past its time (exit code 3, that query answered as timed out), or
// DataFusion ends it (a crash: the query it was on, the first with no answer, answered so): the
// queries still without an answer are run again, by a new process.
const jobsFile = join(work, 'jobs.json');
const times = [];
let left = jobs;
while (left.length) {
  writeFileSync(jobsFile, JSON.stringify({ models, queries: left }));
  const run = spawnSync(process.env.DATAFUSION_PYTHON || 'python', [join(dirname(fileURLToPath(import.meta.url)), 'run.py'), jobsFile], { encoding: 'utf8', maxBuffer: 1 << 30 });
  if (run.status !== 0 && run.status !== 3) process.stderr.write(run.stderr ?? '');
  for (const line of (run.stdout ?? '').split('\n').filter(Boolean)) {
    const a = JSON.parse(line), job = jobs.find(j => j.id === a.id);
    if (a.ms != null) times.push({ id: a.id, ms: a.ms, bytes: job.sql.length });
    answers.set(a.id, a.error ? { id: a.id, error: a.error } : { id: a.id, columns: job.columns, rows: a.rows });
    if (/^timeout/.test(a.error ?? '')) process.stderr.write(`${a.id}: ${a.error}\n`);
  }
  if (run.status === 0) break;
  const at = left.find(j => !answers.has(j.id));
  if (!at) break;
  if (run.status !== 3) {
    const error = `crash: DataFusion ended (${run.signal ?? `exit code ${run.status}`}) on this query`;
    answers.set(at.id, { id: at.id, error });
    process.stderr.write(`${at.id}: ${error}\n`);
  }
  left = left.filter(j => !answers.has(j.id));
}
for (const q of request.queries) process.stdout.write(`${JSON.stringify(answers.get(q.id) ?? { id: q.id, error: 'no answer from DataFusion' })}\n`);
if (process.env.DAXSQL_TIMES) writeFileSync(process.env.DAXSQL_TIMES, JSON.stringify(times.sort((a, b) => b.ms - a.ms), null, 1));
