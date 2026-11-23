// dax-sql's adapter: reads the request (models, their data as CSV, DAX queries), compiles each
// query with the dax-sql checkout it is given and runs the SQL on DuckDB over that data, and
// writes one JSON answer per line: { id, columns, rows } or { id, error, unsupported? }.
//
//   node engines/dax-sql/adapter.mjs <dax-sql checkout> <request.json>
//
// The checkout and the models are read by db.mjs. DAXSQL_OPTIMIZE=0: the SQL with none of the
// emitter's rewrites (CI checks that the answers are the same: agree.mjs). DAXSQL_PLAN=1: the
// SQL of the query plan, optimized (planSql); DAXSQL_PLAN=raw: the plan as it is;
// DAXSQL_PLAN=correlated: the plan before decorrelation, its scalars standard (DuckDB unnests it);
// DAXSQL_PLAN=unnest: that plan unnested (passes/unnest.js: no apply, for an engine that does not unnest).
import { readFileSync } from 'node:fs';
import { engine, value } from './db.mjs';

const e = await engine(process.argv[2]);
const OPTIMIZE = process.env.DAXSQL_OPTIMIZE === '0' ? { optimize: false } : {};
const PLAN = process.env.DAXSQL_PLAN;

const request = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const dbs = new Map();
for (const q of request.queries) {
  let answer;
  try {
    const key = `${q.model}|${q.data}`;
    if (!dbs.has(key)) dbs.set(key, { ...(await e.database(q.model, q.data)), compilers: new Map() });
    const db = dbs.get(key);
    const roles = JSON.stringify(q.roles ?? null);
    if (!db.compilers.has(roles)) db.compilers.set(roles, e.createCompiler(db.model, { columnNames: 'dax', ...OPTIMIZE, ...(q.roles ? { roles: q.roles } : {}) }));
    const c = db.compilers.get(roles);
    const { sql, columns } = PLAN ? c.planSql(q.dax, PLAN === 'correlated' ? { correlated: true } : PLAN === 'unnest' ? { unnest: true } : { optimize: PLAN !== 'raw' }) : c.compile(q.dax);
    const reader = await db.con.runAndReadAll(sql);
    answer = { id: q.id, columns: columns.map(c => c.name), rows: reader.getRowsJS().map(r => r.map(value)) };
  } catch (err) {
    answer = { id: q.id, error: `${err.code ? `${err.code}: ` : ''}${err.message.split('\n')[0]}`, ...(err.code === 'UNSUPPORTED' ? { unsupported: true } : {}) };
  }
  process.stdout.write(`${JSON.stringify(answer)}\n`);
}
