// dax-sql's adapter for T-SQL: as engines/dax-sql/adapter.mjs, but each query is compiled with
// the `tsql` dialect and run on a Microsoft Fabric lakehouse's SQL analytics endpoint, over the
// suite's data as the lakehouse's own Delta tables (schema daxconf), which lakehouse.py writes:
// the tables a model's queries read, run by Fabric's distributed engine.
//
//   cd conformance/engines/dax-sql-tsql && npm install
//   LAKEHOUSE_WS=<workspace id> LAKEHOUSE_ID=<lakehouse id> LAKEHOUSE_SQL_ENDPOINT=<its SQL endpoint id> \
//     python engines/dax-sql-tsql/lakehouse.py          (once, and again when the data changes)
//   TSQL_HOST=<x>.datawarehouse.fabric.microsoft.com TSQL_DB=<lakehouse> \
//     node runner/run.mjs --adapter "node engines/dax-sql-tsql/adapter.mjs .." --known engines/dax-sql-tsql/known.json
//
// A model whose tables were written from other data than the checkout's (lakehouse.py's hash of
// its model.bim and data/) is refused: write them again.
//
// The token is TSQL_TOKEN, or else the Azure CLI's (az account get-access-token). The driver,
// tedious, is this folder's own dependency: dax-sql only writes SQL.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const here = createRequire(import.meta.url);
const { Connection, Request } = here('tedious');
const engine = resolve(process.argv[2]);
const { createCompiler } = await import(pathToFileURL(join(engine, 'src', 'index.js')));
const { tmslToModel } = await import(pathToFileURL(join(engine, 'formats', 'tmsl.js')));
const requireEngine = createRequire(join(engine, 'package.json'));
async function readModel(path) {
  const text = readFileSync(path, 'utf8');
  if (!/\.ya?ml$/i.test(path)) return JSON.parse(text);
  const { ossieToTmsl } = await import(pathToFileURL(join(engine, 'formats', 'ossie.js')));
  return ossieToTmsl(requireEngine('yaml').parse(text));
}

const HOST = process.env.TSQL_HOST, DB = process.env.TSQL_DB;
if (!HOST || !DB) { console.error('TSQL_HOST and TSQL_DB name the SQL endpoint and its database'); process.exit(2); }
const token = process.env.TSQL_TOKEN
  || execSync('az account get-access-token --resource https://database.windows.net --query accessToken -o tsv', { encoding: 'utf8' }).trim();

// Sessions side by side (TSQL_SESSIONS, 8 by default); a query has TSQL_TIMEOUT_MS (30 s) to answer.
const SESSIONS = Number(process.env.TSQL_SESSIONS || 8), TIMEOUT_MS = Number(process.env.TSQL_TIMEOUT_MS || 30000);
async function session() {
  const conn = new Connection({
    server: HOST,
    authentication: { type: 'azure-active-directory-access-token', options: { token } },
    options: { database: DB, port: 1433, encrypt: true, connectTimeout: 30000, requestTimeout: TIMEOUT_MS },
  });
  await new Promise((ok, fail) => { conn.on('connect', e => (e ? fail(e) : ok())); conn.connect(); });
  const run = sql => new Promise((ok, fail) => {
    let cols = [];
    const rows = [];
    const req = new Request(sql, e => (e ? fail(e) : ok({ cols, rows })));
    req.on('columnMetadata', c => { cols = c.map(x => x.type.name); });
    req.on('row', r => rows.push(r.map(c => c.value)));
    conn.execSqlBatch(req);
  });
  return { run, dbs: new Map(), close: () => conn.close() };
}

// --- the data: the lakehouse's tables (lakehouse.py) ---

const SCHEMA = 'daxconf';
const ident = s => `"${String(s).replace(/"/g, '""')}"`;
// A column's name in its Delta table, as lakehouse.py's safe() writes it.
const safe = (i, name) => `c${i}_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)}`;
// lakehouse.py's data_hash: the CSVs by name in code point order, then model.bim; each its name and bytes.
function dataHash(modelPath, dataDir) {
  const h = createHash('sha256');
  const files = readdirSync(dataDir).filter(f => f.endsWith('.csv')).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map(f => join(dataDir, f));
  for (const f of [...files, modelPath]) { h.update(basename(f)); h.update(readFileSync(f)); }
  return h.digest('hex');
}

// A model's tables, read in a session: each the Delta table's columns under the model's names.
async function database({ run }, modelPath, dataDir) {
  const bim = await readModel(modelPath);
  const name = basename(dirname(modelPath));
  const stored = (await run(`SELECT hash FROM ${ident(SCHEMA)}.${ident(`${name}__data`)}`)).rows[0]?.[0];
  if (stored !== dataHash(modelPath, dataDir)) throw new Error(`the lakehouse's tables of ${name} are not this checkout's data: run engines/dax-sql-tsql/lakehouse.py ${name}`);
  const sources = new Map();
  for (const t of bim.model.tables) {
    const s = t.partitions?.[0]?.source;
    if (s?.type !== 'entity') continue;
    const cols = t.columns.filter(c => !c.type || c.type === 'data').map(c => c.sourceColumn ?? c.name);
    sources.set(s.entityName, `(SELECT ${cols.map((c, i) => `${ident(safe(i, c))} AS ${ident(c)}`).join(', ')} FROM ${ident(SCHEMA)}.${ident(`${name}_${s.entityName.toLowerCase()}`)})`);
  }
  const tableSource = t => sources.get(t.source?.entity ?? t.name);
  return { model: tmslToModel(bim), tableSource, compilers: new Map() };
}

function value(v, type) {
  if (v === null || v === undefined) return null;
  // A BIGINT (IntN of 8 bytes) and a DECIMAL come as text.
  if (typeof v === 'string' && /Int|Decimal|Numeric|Money/i.test(type)) return Number(v);
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
  }
  return v;
}

async function answer(ses, q) {
  try {
    const key = `${q.model}|${q.data}`;
    if (!ses.dbs.has(key)) ses.dbs.set(key, database(ses, q.model, q.data));
    const db = await ses.dbs.get(key);
    const roles = JSON.stringify(q.roles ?? null);
    if (!db.compilers.has(roles)) {
      db.compilers.set(roles, createCompiler(db.model, { dialect: 'tsql', columnNames: 'dax', tableSource: db.tableSource, ...(q.roles ? { roles: q.roles } : {}) }));
    }
    const { sql, columns } = db.compilers.get(roles).compile(q.dax);
    if (process.env.TSQL_SHOW) console.error(`${q.id}\n${sql}\n`);
    const t0 = performance.now();
    const r = await ses.run(sql);
    times.push({ id: q.id, ms: Math.round(performance.now() - t0), bytes: sql.length });
    return { id: q.id, columns: columns.map(c => c.name), rows: r.rows.map(row => row.map((v, i) => value(v, r.cols[i]))) };
  } catch (e) {
    const said = e.message || (e.errors ?? []).map(x => x.message).join('; ') || String(e);
    return { id: q.id, error: `${e.code ? `${e.code}: ` : ''}${said.split('\n')[0]}`, ...(e.code === 'UNSUPPORTED' ? { unsupported: true } : {}) };
  }
}

// With TSQL_TIMES, each query's time to answer (ms) and its SQL's length, written to that file.
const times = [];

// The queries of a model together, so a session loads few models.
const request = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const queue = [...request.queries].sort((a, b) => (a.model < b.model ? -1 : a.model > b.model ? 1 : 0));
const sessions = await Promise.all(Array.from({ length: Math.min(SESSIONS, queue.length || 1) }, session));
await Promise.all(sessions.map(async ses => {
  for (let q; (q = queue.shift());) process.stdout.write(`${JSON.stringify(await answer(ses, q))}\n`);
}));
sessions.forEach(s => s.close());
if (process.env.TSQL_TIMES) writeFileSync(process.env.TSQL_TIMES, JSON.stringify(times.sort((a, b) => b.ms - a.ms), null, 1));
