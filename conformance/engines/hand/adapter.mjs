// A second oracle: SQL written by hand for DuckDB, the way an engineer who knows the data would
// write it, one file per query (hand/<model>/<family>/<id>.sql), over the model's tables by their
// source names (store_sales, date_dim, ...). As an engine of the suite (runner/run.mjs), its
// answers are held to Power BI's, which says the SQL means what the DAX means; at a TPC-DS scale
// factor (tools/tpcds/scale-engine.mjs) its times are what dax-sql's are compared with.
//
//   node engines/hand/adapter.mjs <dax-sql checkout> <request.json>
//
// HAND_DUCKDB=<file>: the tables are that DuckDB file's (read only: tools/tpcds/scale.mjs writes
// it, the file dax-sql's SQL runs on at scale), not the request's CSVs. HAND_TIMEOUT (seconds): a
// query past it is interrupted. DAXSQL_TIMES: each query's time and its SQL's size, to that file.
// A query with no file is unsupported.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { engine, value } from '../dax-sql/db.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const models = readdirSync(here).filter(m => statSync(join(here, m)).isDirectory());
const e = await engine(process.argv[2]);
const request = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const timeout = Number(process.env.HAND_TIMEOUT ?? 0) * 1000;
const fileCon = process.env.HAND_DUCKDB
  ? await (await e.DuckDBInstance.create(process.env.HAND_DUCKDB, { access_mode: 'READ_ONLY' })).connect()
  : null;
const dbs = new Map();
const times = [];
for (const q of request.queries) {
  let answer;
  // The runner's ids name the model (tpcds/bench/<id>), tools/tpcds/scale-engine.mjs's do not
  // (bench/<id>): the file under a model's folder.
  const file = [q.id, ...models.map(m => `${m}/${q.id}`)].map(p => join(here, `${p}.sql`)).find(existsSync);
  if (!file) answer = { id: q.id, error: 'no hand-written SQL', unsupported: true };
  else {
    const sql = readFileSync(file, 'utf8');
    let timer;
    try {
      const key = `${q.model}|${q.data}`;
      if (!fileCon && !dbs.has(key)) dbs.set(key, (await e.database(q.model, q.data)).con);
      const con = fileCon ?? dbs.get(key);
      if (timeout) timer = setTimeout(() => con.interrupt(), timeout);
      const t0 = performance.now();
      const reader = await con.runAndReadAll(sql);
      const ms = Math.round(performance.now() - t0);
      times.push({ id: q.id, ms, bytes: sql.length });
      answer = { id: q.id, columns: reader.columnNames(), rows: reader.getRowsJS().map(r => r.map(value)) };
    } catch (err) {
      answer = { id: q.id, error: timeout && /interrupt/i.test(err.message) ? `timeout (${timeout / 1000} s)` : err.message.split('\n')[0] };
    } finally { clearTimeout(timer); }
  }
  process.stdout.write(`${JSON.stringify(answer)}\n`);
}
if (process.env.DAXSQL_TIMES) writeFileSync(process.env.DAXSQL_TIMES, JSON.stringify(times.sort((a, b) => b.ms - a.ms), null, 1));
