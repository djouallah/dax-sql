// dax-sql's adapter: reads the request (models, their data as CSV, DAX queries), compiles each
// query with the dax-sql checkout it is given and runs the SQL on DuckDB over that data, and
// writes one JSON answer per line: { id, columns, rows } or { id, error, unsupported? }.
//
//   node engines/dax-sql/adapter.mjs <dax-sql checkout> <request.json>
//
// The checkout and the models are read by db.mjs. Every SQL is written from the plan as
// Substrait. DAXSQL_PLAN=1: the plan optimized (planSql); DAXSQL_PLAN=correlated: the plan before decorrelation, its scalars standard (DuckDB unnests it);
// DAXSQL_PLAN=unnest: that plan unnested (passes/unnest.js: no apply, for an engine that does not unnest).
// DAXSQL_ORPHANS=1: the compiler told, for each relationship, whether its many side holds a key the
// one side lacks (the orphans option), as the data says: the answers must be those without it.
import { readFileSync, writeFileSync } from 'node:fs';
import { engine, value } from './db.mjs';

const e = await engine(process.argv[2]);
const PLAN = process.env.DAXSQL_PLAN;

// With DAXSQL_TIMES, each query's time to answer (ms, as the T-SQL adapter measures it), to that file.
const times = [];
const request = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const dbs = new Map();
// Whether each relationship's many side holds a key its one side lacks, read from the data with the
// compiler's own statement (orphanCheck): a map of rel.key to true or false.
async function orphansOf(db) {
  const { sql, rels } = e.createCompiler(db.model).orphanCheck();
  const row = (await db.con.runAndReadAll(sql)).getRowsJS()[0];
  return new Map(rels.map((r, i) => [r.key, row[i] === true]));
}
for (const q of request.queries) {
  let answer;
  try {
    const key = `${q.model}|${q.data}`;
    if (!dbs.has(key)) {
      const d = await e.database(q.model, q.data);
      const known = process.env.DAXSQL_ORPHANS ? await orphansOf(d) : null;
      dbs.set(key, { ...d, compilers: new Map(), orphans: known && (rel => known.get(rel.key)) });
    }
    const db = dbs.get(key);
    const roles = JSON.stringify(q.roles ?? null);
    if (!db.compilers.has(roles)) db.compilers.set(roles, e.createCompiler(db.model, { columnNames: 'dax', ...(q.roles ? { roles: q.roles } : {}), ...(db.orphans ? { orphans: db.orphans } : {}) }));
    const c = db.compilers.get(roles);
    const { sql, columns } = PLAN ? c.planSql(q.dax, PLAN === 'correlated' ? { correlated: true } : PLAN === 'unnest' ? { unnest: true } : {}) : c.compile(q.dax);
    const t0 = performance.now();
    const reader = await db.con.runAndReadAll(sql);
    times.push({ id: q.id, ms: Math.round(performance.now() - t0), bytes: sql.length });
    answer = { id: q.id, columns: columns.map(c => c.name), rows: reader.getRowsJS().map(r => r.map(value)) };
  } catch (err) {
    answer = { id: q.id, error: `${err.code ? `${err.code}: ` : ''}${err.message.split('\n')[0]}`, ...(err.code === 'UNSUPPORTED' ? { unsupported: true } : {}) };
  }
  process.stdout.write(`${JSON.stringify(answer)}\n`);
}
if (process.env.DAXSQL_TIMES) writeFileSync(process.env.DAXSQL_TIMES, JSON.stringify(times.sort((a, b) => b.ms - a.ms), null, 1));
