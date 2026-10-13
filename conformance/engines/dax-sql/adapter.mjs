// dax-sql's adapter: reads the request (models, their data as CSV, DAX queries), compiles each
// query with the dax-sql checkout it is given and runs the SQL on DuckDB over that data, and
// writes one JSON answer per line: { id, columns, rows } or { id, error, unsupported? }.
//
//   node engines/dax-sql/adapter.mjs <dax-sql checkout> <request.json>
//
// The compiler and DuckDB both come from the checkout (its src/ and its node_modules), so the
// suite tests whichever commit is there and needs no dependency of its own.
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const engine = resolve(process.argv[2]);
const { createCompiler } = await import(pathToFileURL(join(engine, 'src', 'index.js')));
const { DuckDBInstance } = createRequire(join(engine, 'package.json'))('@duckdb/node-api');

const DUCK_TYPE = { int64: 'BIGINT', double: 'DOUBLE', decimal: 'DECIMAL(18,4)', string: 'VARCHAR', boolean: 'BOOLEAN' };
const sqlString = s => `'${String(s).replace(/'/g, "''")}'`;
const ident = s => `"${String(s).replace(/"/g, '""')}"`;

async function database(modelPath, dataDir) {
  const bim = JSON.parse(readFileSync(modelPath, 'utf8'));
  const db = await DuckDBInstance.create(':memory:');
  const con = await db.connect();
  for (const t of bim.model.tables) {
    const s = t.partitions?.[0]?.source;
    if (s?.type !== 'entity') continue;
    const file = join(dataDir, `${s.entityName}.csv`);
    if (!existsSync(file)) throw new Error(`no data for ${t.name}: ${file}`);
    const text = readFileSync(file, 'utf8');
    const cols = t.columns.filter(c => !c.type || c.type === 'data');
    const types = cols.map(c => {
      if (c.dataType !== 'dateTime') return DUCK_TYPE[c.dataType] ?? 'VARCHAR';
      return /\d{4}-\d\d-\d\d[ T]\d/.test(text) ? 'TIMESTAMP' : 'DATE';
    });
    const columns = `{${cols.map((c, i) => `${sqlString(c.sourceColumn ?? c.name)}: ${sqlString(types[i])}`).join(', ')}}`;
    await con.run(`CREATE TABLE ${ident(s.entityName)} AS SELECT * FROM read_csv(${sqlString(file)}, header = true, columns = ${columns}, nullstr = '', allow_quoted_nulls = false, quote = '"', escape = '"')`);
  }
  return { bim, con, compilers: new Map() };
}

function value(v) {
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
  }
  if (v && typeof v === 'object' && 'toDouble' in v) return v.toDouble();
  return v;
}

const request = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const dbs = new Map();
for (const q of request.queries) {
  let answer;
  try {
    const key = `${q.model}|${q.data}`;
    if (!dbs.has(key)) dbs.set(key, await database(q.model, q.data));
    const db = dbs.get(key);
    const roles = JSON.stringify(q.roles ?? null);
    if (!db.compilers.has(roles)) db.compilers.set(roles, createCompiler(db.bim, { columnNames: 'dax', ...(q.roles ? { roles: q.roles } : {}) }));
    const { sql, columns } = db.compilers.get(roles).compile(q.dax);
    const reader = await db.con.runAndReadAll(sql);
    answer = { id: q.id, columns: columns.map(c => c.name), rows: reader.getRowsJS().map(r => r.map(value)) };
  } catch (e) {
    answer = { id: q.id, error: `${e.code ? `${e.code}: ` : ''}${e.message.split('\n')[0]}`, ...(e.code === 'UNSUPPORTED' ? { unsupported: true } : {}) };
  }
  process.stdout.write(`${JSON.stringify(answer)}\n`);
}
