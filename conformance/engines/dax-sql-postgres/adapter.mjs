// dax-sql's adapter for PostgreSQL: as engines/dax-sql/adapter.mjs, but each query is compiled with
// the `postgres` dialect and run on a PostgreSQL server, over the suite's data copied into it: each
// model's tables in a schema of its own, read from the CSVs by DuckDB as the DuckDB adapter reads
// them (db.mjs), so that both hold the same values of the same types.
//
//   cd conformance/engines/dax-sql-postgres && npm install
//   PGHOST=... PGUSER=... PGPASSWORD=... PGDATABASE=... \
//     node runner/run.mjs --adapter "node engines/dax-sql-postgres/adapter.mjs .." --known engines/dax-sql-postgres/known.json
//
// The driver, pg, is this folder's own dependency: dax-sql only writes SQL. A query has
// PG_TIMEOUT_MS (30 s) to answer; PG_SESSIONS (4) run side by side; with PG_TIMES, each query's
// time to answer and its SQL's length are written to that file; with PG_PLANS, the plan (EXPLAIN)
// and the SQL of each query past its time.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const here = createRequire(import.meta.url);
const pg = here('pg');
const root = resolve(process.argv[2]);
const { engine } = await import(pathToFileURL(join(root, 'conformance', 'engines', 'dax-sql', 'db.mjs')));
const e = await engine(root);

// Values as text, as the suite's answers hold them: a whole number and a NUMERIC as a number,
// a date as itself, a timestamp to the second (at midnight, the date alone).
pg.types.setTypeParser(20, Number);
pg.types.setTypeParser(1700, Number);
pg.types.setTypeParser(1082, v => v);
pg.types.setTypeParser(1114, v => (/ 00:00:00(?:\.0+)?$/.test(v) ? v.slice(0, 10) : v.slice(0, 19)));

const TIMEOUT_MS = Number(process.env.PG_TIMEOUT_MS || 30000), SESSIONS = Number(process.env.PG_SESSIONS || 4);
const ident = s => `"${String(s).replace(/"/g, '""')}"`;
const PG_TYPE = t => (t === 'DOUBLE' ? 'DOUBLE PRECISION' : t === 'VARCHAR' ? 'TEXT' : t);
const connect = async () => {
  const c = new pg.Client({ statement_timeout: TIMEOUT_MS });
  await c.connect();
  return c;
};

// A model's tables, written once into schema m_<model> from DuckDB's copy of its CSVs.
async function load(client, modelPath, dataDir) {
  const name = basename(dirname(modelPath)), schema = `m_${name}`;
  const db = await e.database(modelPath, dataDir);
  await client.query(`DROP SCHEMA IF EXISTS ${ident(schema)} CASCADE; CREATE SCHEMA ${ident(schema)}`);
  for (const t of db.bim.model.tables) {
    const s = t.partitions?.[0]?.source;
    if (s?.type !== 'entity') continue;
    const cols = (await db.con.runAndReadAll(`DESCRIBE ${ident(s.entityName)}`)).getRowsJS().map(r => ({ name: r[0], type: PG_TYPE(String(r[1])) }));
    const table = `${ident(schema)}.${ident(s.entityName)}`;
    await client.query(`CREATE TABLE ${table} (${cols.map(c => `${ident(c.name)} ${c.type}`).join(', ')})`);
    const rows = (await db.con.runAndReadAll(`SELECT ${cols.map(c => `CAST(${ident(c.name)} AS VARCHAR)`).join(', ')} FROM ${ident(s.entityName)}`)).getRowsJS();
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500), params = [];
      const values = batch.map(r => `(${r.map((v, j) => { params.push(v); return `CAST($${params.length} AS ${cols[j].type})`; }).join(', ')})`);
      await client.query(`INSERT INTO ${table} VALUES ${values.join(', ')}`, params);
    }
  }
  const sources = new Map(db.bim.model.tables.filter(t => t.partitions?.[0]?.source?.type === 'entity')
    .map(t => [t.partitions[0].source.entityName, `${ident(schema)}.${ident(t.partitions[0].source.entityName)}`]));
  return { model: db.model, tableSource: t => sources.get(t.source?.entity ?? t.name), compilers: new Map() };
}

const times = [], plans = [];
async function answer(client, db, q) {
  try {
    const roles = JSON.stringify(q.roles ?? null);
    if (!db.compilers.has(roles)) {
      db.compilers.set(roles, e.createCompiler(db.model, { dialect: 'postgres', columnNames: 'dax', tableSource: db.tableSource, ...(q.roles ? { roles: q.roles } : {}) }));
    }
    const { sql, columns } = db.compilers.get(roles).compile(q.dax);
    if (process.env.PG_SHOW) console.error(`${q.id}\n${sql}\n`);
    const t0 = performance.now();
    const r = await client.query({ text: sql, rowMode: 'array' }).catch(err => { err.sql = sql; throw err; });
    times.push({ id: q.id, ms: Math.round(performance.now() - t0), bytes: sql.length });
    return { id: q.id, columns: columns.map(c => c.name), rows: r.rows };
  } catch (err) {
    if (err.code === '57014' && process.env.PG_PLANS && err.sql) {
      try { plans.push({ id: q.id, sql: err.sql, plan: (await client.query(`EXPLAIN ${err.sql}`)).rows.map(r => r['QUERY PLAN']).join('\n') }); } catch {}
    }
    return { id: q.id, error: `${err.code ? `${err.code}: ` : ''}${String(err.message).split('\n')[0]}`, ...(err.code === 'UNSUPPORTED' ? { unsupported: true } : {}) };
  }
}

const request = JSON.parse(readFileSync(process.argv[3], 'utf8'));
// Every model the queries read, loaded before any query runs.
const loader = await connect();
const dbs = new Map();
for (const q of request.queries) {
  const key = `${q.model}|${q.data}`;
  if (!dbs.has(key)) dbs.set(key, await load(loader, q.model, q.data));
}
await loader.end();
const queue = [...request.queries];
await Promise.all(Array.from({ length: Math.min(SESSIONS, queue.length || 1) }, async () => {
  let client = await connect();
  for (let q; (q = queue.shift());) {
    const a = await answer(client, dbs.get(`${q.model}|${q.data}`), q);
    process.stdout.write(`${JSON.stringify(a)}\n`);
    // A statement past its time leaves the session usable; a broken connection does not.
    if (a.error && /terminat|connection/i.test(a.error)) { try { await client.end(); } catch {} client = await connect(); }
  }
  await client.end();
}));
if (process.env.PG_PLANS) writeFileSync(process.env.PG_PLANS, plans.map(p => `### ${p.id}\n\n${p.plan}\n\n${p.sql}\n`).join('\n'));
if (process.env.PG_TIMES) writeFileSync(process.env.PG_TIMES, JSON.stringify(times.sort((a, b) => b.ms - a.ms), null, 1));
