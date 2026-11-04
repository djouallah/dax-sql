// dax-sql's adapter for T-SQL: as engines/dax-sql/adapter.mjs, but each query is compiled with
// the `tsql` dialect and run on a Microsoft Fabric SQL endpoint (a lakehouse's SQL analytics
// endpoint or a warehouse), its data loaded into the session's #temp tables, so nothing is
// written to the item.
//
//   cd conformance/engines/dax-sql-tsql && npm install
//   TSQL_HOST=<x>.datawarehouse.fabric.microsoft.com TSQL_DB=<item> \
//     node runner/run.mjs --adapter "node engines/dax-sql-tsql/adapter.mjs .." --known engines/dax-sql-tsql/known.json
//
// The token is TSQL_TOKEN, or else the Azure CLI's (az account get-access-token). The driver,
// tedious, is this folder's own dependency: dax-sql only writes SQL.
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
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

// Sessions side by side (TSQL_SESSIONS, 8 by default), each with the data in its own #temp
// tables; a query has TSQL_TIMEOUT_MS (30 s) to answer.
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

// --- the data, as #temp tables ---

const TSQL_TYPE = { int64: 'BIGINT', double: 'FLOAT', decimal: 'DECIMAL(18,4)', string: 'VARCHAR(8000)', boolean: 'BIT' };
const str = s => `${/[^\x00-\x7f]/.test(s) ? 'N' : ''}'${String(s).replace(/'/g, "''")}'`;
const ident = s => `"${String(s).replace(/"/g, '""')}"`;
const temp = entity => ident(`#${entity}`);

// RFC 4180, as the DuckDB adapter reads it: an empty field unquoted is NULL, "" is ''.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false, inQuotes = false, i = 0;
  const end = () => { row.push(quoted || field !== '' ? field : null); field = ''; quoted = false; };
  for (; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') inQuotes = false; else field += c;
    } else if (c === '"') { inQuotes = true; quoted = true; } else if (c === ',') end();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      end(); rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || quoted || row.length) { end(); rows.push(row); }
  return rows;
}

// A model's tables in a session, under a prefix of the model's own, so two models' tables of
// one name differ.
const prefixes = new Map();
async function database({ run }, modelPath, dataDir) {
  const bim = await readModel(modelPath);
  const key = `${modelPath}|${dataDir}`;
  if (!prefixes.has(key)) prefixes.set(key, `m${prefixes.size + 1}_`);
  const prefix = prefixes.get(key);
  for (const t of bim.model.tables) {
    const s = t.partitions?.[0]?.source;
    if (s?.type !== 'entity') continue;
    const file = join(dataDir, `${s.entityName}.csv`);
    if (!existsSync(file)) throw new Error(`no data for ${t.name}: ${file}`);
    const text = readFileSync(file, 'utf8');
    const [, ...rows] = parseCsv(text).filter(r => r.length > 1 || r[0] !== null);
    const cols = t.columns.filter(c => !c.type || c.type === 'data');
    const types = cols.map(c => (c.dataType !== 'dateTime' ? TSQL_TYPE[c.dataType] ?? 'VARCHAR(8000)'
      : /\d{4}-\d\d-\d\d[ T]\d/.test(text) ? 'DATETIME2(6)' : 'DATE'));
    const name = temp(prefix + s.entityName);
    await run(`CREATE TABLE ${name} (${cols.map((c, i) => `${ident(c.sourceColumn ?? c.name)} ${types[i]} NULL`).join(', ')})`);
    const lit = (v, ty) => (v === null ? 'NULL' : ty === 'BIT' ? (/^(true|1)$/i.test(v) ? '1' : '0')
      : /^(BIGINT|FLOAT|DECIMAL)/.test(ty) ? (v === '' ? 'NULL' : v) : str(v));
    for (let i = 0; i < rows.length; i += 1000) {
      const part = rows.slice(i, i + 1000).map(r => `(${cols.map((_, j) => lit(r[j] ?? null, types[j])).join(', ')})`);
      await run(`INSERT INTO ${name} VALUES ${part.join(', ')}`);
    }
  }
  const tableSource = t => temp(prefix + (t.source?.entity ?? t.name));
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
    const r = await ses.run(sql);
    return { id: q.id, columns: columns.map(c => c.name), rows: r.rows.map(row => row.map((v, i) => value(v, r.cols[i]))) };
  } catch (e) {
    const said = e.message || (e.errors ?? []).map(x => x.message).join('; ') || String(e);
    return { id: q.id, error: `${e.code ? `${e.code}: ` : ''}${said.split('\n')[0]}`, ...(e.code === 'UNSUPPORTED' ? { unsupported: true } : {}) };
  }
}

// The queries of a model together, so a session loads few models.
const request = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const queue = [...request.queries].sort((a, b) => (a.model < b.model ? -1 : a.model > b.model ? 1 : 0));
const sessions = await Promise.all(Array.from({ length: Math.min(SESSIONS, queue.length || 1) }, session));
await Promise.all(sessions.map(async ses => {
  for (let q; (q = queue.shift());) process.stdout.write(`${JSON.stringify(await answer(ses, q))}\n`);
}));
sessions.forEach(s => s.close());
