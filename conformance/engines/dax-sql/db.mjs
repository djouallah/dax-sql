// A dax-sql checkout, and the suite's models on DuckDB, for the adapter (adapter.mjs) and the
// check that runs every query by two checkouts (bench.mjs).
//   const e = await engine('<dax-sql checkout>');
//   const db = await e.database(modelPath, dataDir);   // { bim, model, con }
//   const { sql, columns } = e.createCompiler(db.model, options).compile(dax);
// The compiler and DuckDB both come from the checkout (its src/ and its node_modules), so a
// check tests whichever commit is there. The model is read from the TMSL with the checkout's
// formats/tmsl.js (a checkout from before formats/ took the TMSL itself); one given as an
// Apache Ossie YAML file is read as the TMSL it stands for (formats/ossie.js; `yaml` from the
// checkout).
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DUCK_TYPE = { int64: 'BIGINT', double: 'DOUBLE', decimal: 'DECIMAL(18,4)', string: 'VARCHAR', boolean: 'BOOLEAN' };
const sqlString = s => `'${String(s).replace(/'/g, "''")}'`;
const ident = s => `"${String(s).replace(/"/g, '""')}"`;

export async function engine(dir, { DuckDBInstance: duck } = {}) {
  const root = resolve(dir);
  const { createCompiler } = await import(pathToFileURL(join(root, 'src', 'index.js')));
  const require = createRequire(join(root, 'package.json'));
  const DuckDBInstance = duck ?? require('@duckdb/node-api').DuckDBInstance;
  const formats = existsSync(join(root, 'formats', 'tmsl.js'));
  const { tmslToModel } = formats ? await import(pathToFileURL(join(root, 'formats', 'tmsl.js'))) : { tmslToModel: bim => bim };
  async function readModel(path) {
    const text = readFileSync(path, 'utf8');
    if (!/\.ya?ml$/i.test(path)) return JSON.parse(text);
    const { ossieToTmsl } = await import(pathToFileURL(join(root, 'formats', 'ossie.js')));
    return ossieToTmsl(require('yaml').parse(text));
  }
  // The model and a DuckDB holding its data (one CSV per table); `con` to share one between
  // two checkouts.
  async function database(modelPath, dataDir, con = null) {
    const bim = await readModel(modelPath);
    if (!con) {
      con = await (await DuckDBInstance.create(':memory:')).connect();
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
    }
    return { bim, model: tmslToModel(bim), con };
  }
  return { root, createCompiler, DuckDBInstance, database };
}

// A DuckDB value as the suite's answers hold it.
export function value(v) {
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
  }
  if (v && typeof v === 'object' && 'toDouble' in v) v = v.toDouble();
  // NaN and an infinity, which JSON has no number for, as their names (as the goldens have them).
  if (typeof v === 'number' && !Number.isFinite(v)) return Number.isNaN(v) ? 'NaN' : v > 0 ? 'Infinity' : '-Infinity';
  return v;
}
