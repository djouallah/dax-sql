// Builds, from an Apache Ossie checkout (Apache License 2.0), what Power BI is asked of Ossie's
// tests: Power BI is the reference, Ossie's YAML a model format dax-sql reads.
//   models/scott   compliance/query's SCOTT (scott.sql, scott_model.ossie.yaml)
//   models/retail  compliance/wide_table's retail;   models/stores  its stores
// each as model.bim (formats/ossie.js's ossieToTmsl; not a relationship of a table to itself,
// which Power BI has none of) and data/<table>.csv; and as DAX, as dax-sql's SQL front end writes
// it (sqlToDax), in queries/:
//   scott/ossie/ossie-<case>     each query compliance case
//   <model>/wide/wide-<case>     each wide table case that answers rows (Layer 3 JSON lowered to
//                                its Layer 2 SQL, formats/ossie-wide.js); one that raises an error
//                                stays Ossie's (formats/test/ossie-wide.mjs)
//   <model>/grid/grid-<n>        the view expander's grid of queries (grid.mjs), on every model
// SQL that is a statement (a UNION of model queries, say) is one query a model query in it
// (<id>-<k>): the rest is the engine's SQL.
//
//   node tools/ossie/build.mjs <ossie checkout>
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { DuckDBInstance } from '@duckdb/node-api';
import { createCompiler } from '../../../src/index.js';
import { ossieToModel, ossieToTmsl } from '../../../formats/ossie.js';
import { wideToSql } from '../../../formats/ossie-wide.js';
import { models, shape, grid } from './grid.mjs';

const ossie = process.argv[2];
if (!ossie) throw new Error('usage: node tools/ossie/build.mjs <ossie checkout>');
const root = fileURLToPath(new URL('../../', import.meta.url));
const read = p => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const QUERY = join(ossie, 'compliance', 'query'), WIDE = join(ossie, 'compliance', 'wide_table');

// A query file: its note, the SQL it is, and the DAX.
function writeQueries(model, family, list) {
  const dir = join(root, 'queries', model, family);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const { id, note, sql, dax } of list) writeFileSync(join(dir, `${id}.dax`), `// note: ${note}\n// ${sql.replace(/\s+/g, ' ')}\n${dax}\n`);
  return list.length;
}
// The DAX of SQL over a model: the query's, or each model query's of a statement.
function daxOf(compiler, modelName, sql) {
  try { return [compiler.sqlToDax(sql).dax]; } catch (e) {
    let st = null;
    try { st = compiler.compileStatement(sql, modelName); } catch { throw e; }
    if (!st.relations?.length || st.relations.some(r => !r.dax)) throw e;
    return st.relations.map(r => r.dax);
  }
}
const parts = (id, daxes) => (daxes.length === 1 ? [{ id, dax: daxes[0] }] : daxes.map((dax, k) => ({ id: `${id}-${k + 1}`, dax, part: k + 1, of: daxes.length })));

// --- the models -------------------------------------------------------------------------

const cell = v => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return `"${v.replace(/"/g, '""')}"`;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && typeof v.toDouble === 'function') return String(v.toDouble());
  return String(v);
};
async function buildModel(name, sqlFile, doc) {
  doc = { ...doc, relationships: (doc.relationships ?? []).filter(r => r.from !== r.to) };
  const bim = { ...ossieToTmsl(doc, { onSkip: s => console.log(`${name}: skipped`, s) }), name: `dax-conformance-${name}` };
  // Each table's rows by its name alone, as the suite's other models (data/<table>.csv).
  const schemaOf = new Map();
  for (const t of bim.model.tables) for (const p of t.partitions ?? []) {
    if (p.source?.schemaName) { schemaOf.set(t.name, p.source.schemaName); delete p.source.schemaName; }
  }
  const dir = join(root, 'models', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'model.bim'), JSON.stringify(bim, null, 2) + '\n');
  const db = await DuckDBInstance.create(':memory:');
  const con = await db.connect();
  await con.run(read(sqlFile));
  for (const t of bim.model.tables) {
    const p = t.partitions?.[0]?.source;
    if (p?.type !== 'entity') continue;
    const r = await con.runAndReadAll(`SELECT * FROM ${schemaOf.get(t.name) ?? name}.${p.entityName} ORDER BY ALL`);
    const lines = [r.columnNames().map(c => `"${c}"`).join(','), ...r.getRowsJS().map(row => row.map(cell).join(','))];
    writeFileSync(join(dir, 'data', `${p.entityName}.csv`), lines.join('\n') + '\n');
  }
  console.log(`models/${name}: ${bim.model.tables.length} tables`);
}

// --- the query compliance cases (SCOTT) ------------------------------------------------------

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
function queryCases(compiler) {
  const out = [];
  for (const file of readdirSync(QUERY).filter(f => f.endsWith('.ost')).sort()) {
    const text = read(join(QUERY, file));
    let from = 0;
    for (;;) {
      const at = text.indexOf('executeExpand(', from);
      if (at < 0) break;
      const open = at + 'executeExpand('.length, close = closing(text, open);
      from = close;
      const sql = text.slice(open, close).trim();
      const [, id, title] = [...text.slice(0, at).matchAll(/^# ([AB]\d+[a-z]?)\. (.*)$/gm)].at(-1);
      const name = `ossie-${id.toLowerCase().replace(/^([ab])0*/, '$1')}`;
      try {
        for (const p of parts(name, daxOf(compiler, 'scott_model', sql)))
          out.push({ ...p, sql, note: `Apache Ossie query compliance ${id} (${file}): ${title}${p.part ? ` Model query ${p.part} of ${p.of} of its SQL.` : ''} As dax-sql's SQL front end writes its SQL in DAX:` });
      } catch (e) { console.log(`${id}: not DAX (${e.message.split('\n')[0]})`); }
    }
  }
  return out;
}

// --- the wide table cases --------------------------------------------------------------------

// executeLower(name, <JSON>): the JSON, from its opening brace to the one that closes it.
function jsonOf(src) {
  const at = src.indexOf('executeLower(');
  if (at < 0) return null;
  const open = src.indexOf('{', at);
  let depth = 0, inStr = false;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (inStr) { if (ch === '\\') i++; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return JSON.parse(src.slice(open, i + 1));
  }
  return null;
}
// Each case that answers rows, of the model file `modelFile`: { id, file, title, query }.
function wideCases(modelFile) {
  const out = [];
  for (const file of readdirSync(WIDE).filter(f => f.endsWith('.ost')).sort()) {
    const raw = read(join(WIDE, file)), src = raw.split('\n').filter(l => !l.startsWith('#')).join('\n');
    if (/^> error:/m.test(src) || src.match(/modelFile\("[^"]+",\s*"([^"]+)"\)/)?.[1] !== modelFile) continue;
    const title = raw.match(/^# ([AE]\d+)\. (.*)$/m)?.[2] ?? '';
    out.push({ id: file.split('_')[0].toLowerCase(), file, title, query: jsonOf(src) });
  }
  return out;
}
// The model's measures each case's lowering adds (Section 5.2), so that Power BI has them too.
function withLowered(doc, cases) {
  const out = structuredClone(doc);
  const have = new Map(out.datasets.flatMap(d => (d.metrics ?? []).map(m => [`${d.name}.${m.name}`, m])));
  for (const c of cases) {
    const { doc: d2 } = wideToSql(doc, c.query);
    for (const d of d2.datasets) for (const m of d.metrics ?? []) {
      const k = `${d.name}.${m.name}`, was = have.get(k);
      if (was && JSON.stringify(was.expression) !== JSON.stringify(m.expression)) throw new Error(`${c.id}: ${k} is another measure in another case`);
      if (!was) { (out.datasets.find(x => x.name === d.name).metrics ??= []).push(m); have.set(k, m); }
    }
  }
  return out;
}

// --- build --------------------------------------------------------------------------------

const ossieModels = [
  { name: 'scott', sql: join(QUERY, 'scott', 'scott.sql'), yaml: join(QUERY, 'scott', 'scott_model.ossie.yaml'), wide: null },
  { name: 'retail', sql: join(WIDE, 'retail', 'retail.sql'), yaml: join(WIDE, 'retail', 'retail_model.ossie.yaml'), wide: 'retail/retail_model.ossie.yaml' },
  { name: 'stores', sql: join(WIDE, 'stores', 'stores.sql'), yaml: join(WIDE, 'stores', 'stores_model.ossie.yaml'), wide: 'stores/stores_model.ossie.yaml' },
];
for (const m of ossieModels) {
  let doc = parse(read(m.yaml));
  const cases = m.wide ? wideCases(m.wide) : [];
  doc = withLowered(doc, cases);
  await buildModel(m.name, m.sql, doc);
  const compiler = createCompiler(ossieToModel(doc));
  if (m.name === 'scott') console.log(`queries/scott/ossie: ${writeQueries('scott', 'ossie', queryCases(compiler))}`);
  if (cases.length) {
    const list = [];
    for (const c of cases) {
      const { sql, doc: d2 } = wideToSql(parse(read(m.yaml)), c.query);
      try {
        for (const p of parts(`wide-${c.id}`, daxOf(createCompiler(ossieToModel(d2)), d2.name, sql)))
          list.push({ ...p, sql, note: `Apache Ossie wide table compliance ${c.id.toUpperCase()} (${c.file}): ${c.title} Its Layer 3 query ${JSON.stringify(c.query)}, lowered to Layer 2 SQL${p.part ? `, model query ${p.part} of ${p.of}` : ''}, as dax-sql's SQL front end writes it in DAX:` });
      } catch (e) { console.log(`${c.id}: not DAX (${e.message.split('\n')[0]})`); }
    }
    console.log(`queries/${m.name}/wide: ${writeQueries(m.name, 'wide', list)}`);
  }
}

// The grid, on every model (the Ossie ones as Ossie wrote them, the others as tmslToOssie writes them).
for (const [i, m] of models(ossie).entries()) {
  const db = await DuckDBInstance.create(':memory:');
  const con = await db.connect();
  await m.load(con);
  const doc = parse(m.yaml);
  const sh = await shape(con, doc);
  // A row identity for every dataset with one (the grid's joins need it), as the view expander had.
  for (const d of doc.datasets ?? []) {
    const key = sh.byName.get(d.name)?.key;
    if (!d.primary_key?.length && key) d.primary_key = key;
  }
  const compiler = createCompiler(ossieToModel(doc));
  const list = [];
  let refused = 0;
  for (const [k, q] of grid(doc.name, sh, 1000 + i).entries()) {
    const id = `grid-${String(k + 1).padStart(4, '0')}`;
    try {
      for (const p of parts(id, daxOf(compiler, doc.name, q.sql)))
        list.push({ ...p, sql: q.sql, note: `the view expander's grid (tools/ossie/grid.mjs), ${q.template}${p.part ? `, model query ${p.part} of ${p.of}` : ''}: its SQL as dax-sql's SQL front end writes it in DAX:` });
    } catch { refused++; }
  }
  console.log(`queries/${m.label}/grid: ${writeQueries(m.label, 'grid', list)}${refused ? ` (${refused} not DAX)` : ''}`);
}
