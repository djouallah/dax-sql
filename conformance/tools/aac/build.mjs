// Builds models/aac: the semantic model of djouallah/analytics-as-code (Australia's National
// Electricity Market, the model its dashboard and its Power BI report both read), as
// model.bim and data/<table>.csv, so the queries its dashboard sends are answered by Power BI.
//
// semantic_model.bim next to this file is that repo's semantic_model/model.bim, verbatim, as
// of commit c5d087d42ce56b790693b54e2f105fd9a2d7a792. Its 15 tables, 22 relationships and
// measures are kept as they are. Adapted, only for an Import model with entity partitions:
//   - each table's Direct Lake partition (on a mart table of the nem lakehouse) becomes an
//     entity partition of the same name, and the lakehouse's DirectLake expression goes;
//   - an expression written as an array of lines is joined into one text (TMSL takes both).
// The model has no roles and no calculation groups.
//
// The rows are a small seeded sample in the lakehouse's shape (data.js says what it holds):
// the real ones are in a lakehouse this suite cannot reach.
//
//   node tools/aac/build.mjs
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { csv } from '../csv.mjs';
import { generate } from './data.js';

const source = JSON.parse(readFileSync(new URL('semantic_model.bim', import.meta.url), 'utf8'));
const text = e => (Array.isArray(e) ? e.join('\n') : e);

const { expressions, ...model } = source.model;
const bim = {
  name: 'aac',
  compatibilityLevel: source.compatibilityLevel,
  model: {
    ...model,
    tables: model.tables.map(t => ({
      ...t,
      ...(t.measures ? { measures: t.measures.map(m => ({ ...m, expression: text(m.expression) })) } : {}),
      partitions: [{ name: t.name, source: { type: 'entity', entityName: t.name } }],
    })),
  },
};

// What Power BI would refuse, checked here rather than at publish.
const tables = new Map(bim.model.tables.map(t => [t.name, t]));
for (const t of bim.model.tables) {
  const cols = new Set(t.columns.map(c => c.name.toLowerCase()));
  for (const m of t.measures ?? []) if (cols.has(m.name.toLowerCase())) throw new Error(`${t.name}: measure [${m.name}] is named like a column`);
}
const measureNames = bim.model.tables.flatMap(t => (t.measures ?? []).map(m => m.name.toLowerCase()));
if (new Set(measureNames).size !== measureNames.length) throw new Error('two measures of one name');
for (const r of bim.model.relationships) {
  const type = (t, c) => tables.get(t)?.columns.find(x => x.name === c)?.dataType;
  if (!type(r.fromTable, r.fromColumn) || type(r.fromTable, r.fromColumn) !== type(r.toTable, r.toColumn))
    throw new Error(`relationship ${r.name}: ${r.fromTable}[${r.fromColumn}] and ${r.toTable}[${r.toColumn}] differ in type`);
}

const data = generate();
// The keys a relationship's one side must hold once.
for (const r of bim.model.relationships) {
  const keys = data[r.toTable].map(x => x[r.toColumn]);
  if (new Set(keys).size !== keys.length) throw new Error(`${r.toTable}[${r.toColumn}] is not unique`);
  if (r.relyOnReferentialIntegrity) {
    const held = new Set(keys);
    const missing = data[r.fromTable].find(x => !held.has(x[r.fromColumn]));
    if (missing) throw new Error(`${r.name} relies on integrity, and ${r.fromTable} has ${missing[r.fromColumn]}`);
  }
}

const out = new URL('../../models/aac/', import.meta.url);
rmSync(new URL('data/', out), { recursive: true, force: true });
mkdirSync(new URL('data/', out), { recursive: true });
writeFileSync(new URL('model.bim', out), `${JSON.stringify(bim, null, 2)}\n`);
let n = 0;
for (const t of bim.model.tables) {
  const rows = data[t.name];
  if (!rows) throw new Error(`no rows for ${t.name}`);
  const columns = t.columns.map(c => [c.sourceColumn ?? c.name, c.dataType]);
  for (const r of rows) for (const k of Object.keys(r)) if (!columns.some(([c]) => c === k)) throw new Error(`${t.name} has no column ${k}`);
  writeFileSync(new URL(`data/${t.name}.csv`, out), csv(columns, rows.map(r => columns.map(([c]) => r[c] ?? null))));
  n += rows.length;
}
console.log(`models/aac: ${bim.model.tables.length} tables, ${n} rows (${bim.model.tables.map(t => `${t.name} ${data[t.name].length}`).join(', ')})`);
