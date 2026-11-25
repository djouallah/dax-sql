// Builds models/scott and queries/scott/ossie from Apache Ossie's query compliance suite
// (compliance/query in an Ossie checkout, Apache License 2.0): the SCOTT tables (scott.sql) as
// data/<table>.csv, its model (scott_model.ossie.yaml) as model.bim through formats/ossie.js,
// and each compliance case's SQL as the DAX dax-sql's SQL front end makes of it (sqlToDax), so
// that Power BI answers what that DAX means.
//
//   emp -> dept    pet -> emp (TRAMP has no owner)    bonus -> emp on ename
// emp -> emp (mgr -> empno) is not a relationship here: Power BI has none from a table to itself.
//
//   node tools/scott/build.mjs <ossie checkout>
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { DuckDBInstance } from '@duckdb/node-api';
import { createCompiler } from '../../../src/index.js';
import { ossieToModel, ossieToTmsl } from '../../../formats/ossie.js';

const ossie = process.argv[2];
if (!ossie) throw new Error('usage: node tools/scott/build.mjs <ossie checkout>');
const root = fileURLToPath(new URL('../../', import.meta.url));
const src = join(ossie, 'compliance', 'query');
const read = p => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

// --- the model ---------------------------------------------------------------------------

const doc = parse(read(join(src, 'scott', 'scott_model.ossie.yaml')));
doc.relationships = doc.relationships.filter(r => r.from !== r.to);
const bim = { ...ossieToTmsl(doc, { onSkip: s => console.log('skipped', s) }), name: 'dax-conformance-scott' };
// Each table's rows by its name alone, as the suite's other models (data/<table>.csv).
for (const t of bim.model.tables) for (const p of t.partitions ?? []) if (p.source?.schemaName) delete p.source.schemaName;
const dir = join(root, 'models', 'scott');
rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dir, 'data'), { recursive: true });
writeFileSync(join(dir, 'model.bim'), JSON.stringify(bim, null, 2) + '\n');

// --- the data ----------------------------------------------------------------------------

const db = await DuckDBInstance.create(':memory:');
const con = await db.connect();
await con.run(read(join(src, 'scott', 'scott.sql')));
const cell = v => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return `"${v.replace(/"/g, '""')}"`;
  if (typeof v === 'bigint' || typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v.toDouble === 'function') return String(v.toDouble());
  return String(v);
};
for (const t of bim.model.tables) {
  const p = t.partitions?.[0]?.source;
  if (p?.type !== 'entity') continue;
  const r = await con.runAndReadAll(`SELECT * FROM scott.${p.entityName} ORDER BY ALL`);
  const lines = [r.columnNames().map(c => `"${c}"`).join(','), ...r.getRowsJS().map(row => row.map(cell).join(','))];
  writeFileSync(join(dir, 'data', `${p.entityName}.csv`), lines.join('\n') + '\n');
}

// --- the queries: each compliance case's SQL, as DAX ------------------------------------

// The text from `open` (just after a "(") to its ")", by depth, outside strings and quoted names.
function closing(s, open) {
  let depth = 1;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"') { i = s.indexOf(c, i + 1); if (i < 0) break; continue; }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  throw new Error('executeExpand( with no closing ")"');
}
const dax = createCompiler(ossieToModel(parse(read(join(src, 'scott', 'scott_model.ossie.yaml')))));
const qdir = join(root, 'queries', 'scott', 'ossie');
rmSync(qdir, { recursive: true, force: true });
mkdirSync(qdir, { recursive: true });
let n = 0;
for (const file of readdirSync(src).filter(f => f.endsWith('.ost')).sort()) {
  const text = read(join(src, file));
  let from = 0, k = 0;
  for (;;) {
    const at = text.indexOf('executeExpand(', from);
    if (at < 0) break;
    const open = at + 'executeExpand('.length, close = closing(text, open);
    from = close;
    const sql = text.slice(open, close).trim();
    const ids = [...text.slice(0, at).matchAll(/^# ([AB]\d+[a-z]?)\. (.*)$/gm)];
    const [, id, title] = ids.at(-1) ?? [null, `${file.replace(/\.ost$/, '')}-${++k}`, ''];
    let q;
    try { q = dax.sqlToDax(sql).dax; } catch (e) { console.log(`${id}: not DAX (${e.message.split('\n')[0]})`); continue; }
    const name = `ossie-${id.toLowerCase().replace(/^([ab])0*/, '$1')}`;
    writeFileSync(join(qdir, `${name}.dax`), `// note: Apache Ossie query compliance ${id} (${file}): ${title} As dax-sql's SQL front end writes its SQL in DAX:\n// ${sql.replace(/\s+/g, ' ')}\n${q}\n`);
    n++;
  }
}
console.log(`models/scott: ${bim.model.tables.length} tables; queries/scott/ossie: ${n} queries`);
