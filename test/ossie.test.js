// An Apache Ossie model: the contoso model written as Ossie (its tables of the lakehouse;
// Ossie has no calculated tables or calculation groups) compiles each query to the SQL its
// TMSL does, and the SQL runs. What Ossie has no property for (an inactive or many-to-many
// relationship, the date table, the roles, a measure's home table) is in POWER_BI extensions.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers.js';
import { bim as contoso, setup } from './fixtures/contoso.js';
import { createCompiler } from '../src/index.js';
import { isOssie } from '../src/ossie.js';

const TYPES = { string: 'String', int64: 'Integer', decimal: 'Decimal', double: 'Float', boolean: 'Boolean', dateTime: 'DateTime' };
const text = e => (Array.isArray(e) ? e.join('\n') : e);
// The properties Ossie has no place for, as the POWER_BI extension.
const rest = (o, used) => {
  const left = Object.fromEntries(Object.entries(o).filter(([k]) => !used.includes(k)));
  return Object.keys(left).length ? { custom_extensions: [{ vendor_name: 'POWER_BI', data: JSON.stringify(left) }] } : {};
};

const tmsl = { ...contoso.model, tables: contoso.model.tables.filter(t => t.partitions?.[0]?.source?.type === 'entity') };
const ossie = {
  version: '0.2.0.dev0',
  name: 'contoso',
  datasets: tmsl.tables.map(t => ({
    name: t.name,
    source: t.partitions[0].source.entityName,
    ...(t.columns.some(c => c.isKey) ? { primary_key: t.columns.filter(c => c.isKey).map(c => c.name) } : {}),
    fields: t.columns.map(c => ({
      name: c.name,
      expression: { dialects: [c.type === 'calculated' ? { dialect: 'DAX', expression: text(c.expression) } : { dialect: 'ANSI_SQL', expression: c.sourceColumn }] },
      datatype: TYPES[c.dataType],
      ...rest(c, ['name', 'dataType', 'sourceColumn', 'type', 'expression', 'isKey']),
    })),
    ...rest(t, ['name', 'columns', 'measures', 'partitions']),
  })),
  relationships: tmsl.relationships.map(r => ({
    name: r.name, from: r.fromTable, to: r.toTable, from_columns: [r.fromColumn], to_columns: [r.toColumn],
    ...rest(r, ['name', 'fromTable', 'fromColumn', 'toTable', 'toColumn']),
  })),
  metrics: tmsl.tables.flatMap(t => (t.measures ?? []).map(m => ({
    name: m.name,
    expression: { dialects: [{ dialect: 'DAX', expression: text(m.expression) }] },
    ...rest({ ...m, table: t.name }, ['name', 'expression']),
  }))),
  ...rest(tmsl, ['tables', 'relationships']),
};

const QUERIES = [
  'EVALUATE SUMMARIZECOLUMNS(Product[Color], "s", [Sales Amount])',
  'EVALUATE SUMMARIZECOLUMNS(Category[Category], Customer[City], "s", [Sales Amount], "o", [Orders])',
  'EVALUATE ROW("u", CALCULATE([Sales Amount], USERELATIONSHIP(Sales[ShipDate], \'Date\'[Date])))',
  'EVALUATE SUMMARIZECOLUMNS(Customer[City], "t", [Target])',
  'EVALUATE SUMMARIZECOLUMNS(\'Date\'[Year], "ytd", TOTALYTD([Sales Amount], \'Date\'[Date]))',
  'EVALUATE SUMMARIZECOLUMNS(Product[Color], "s", [Sales Amount], "r", COUNTROWS(Returns))',
];

let h, fromTmsl;
before(async () => {
  h = await harness(ossie, setup);
  fromTmsl = createCompiler({ model: tmsl });
});

test('an Ossie document is told from a TMSL one', () => {
  assert.ok(isOssie(ossie));
  assert.ok(!isOssie(contoso));
});

test('an Ossie model compiles as its TMSL does, and runs', async () => {
  for (const q of QUERIES) {
    assert.equal(h.dax.compile(q).sql, fromTmsl.compile(q).sql, q);
    await h.run(q);
  }
});

test('a role of the POWER_BI extension filters', async () => {
  const q = 'EVALUATE SUMMARIZECOLUMNS(Customer[City], "s", [Sales Amount])';
  const sql = createCompiler(ossie, { roles: 'Paris' }).compile(q).sql;
  assert.equal(sql, createCompiler({ model: tmsl }, { roles: 'Paris' }).compile(q).sql);
  assert.notEqual(sql, h.dax.compile(q).sql);
});

test('a metric with no DAX is refused', () => {
  const bad = { ...ossie, metrics: [{ name: 'x', expression: { dialects: [{ dialect: 'ANSI_SQL', expression: 'SUM(a)' }] } }] };
  assert.throws(() => createCompiler(bad), /no DAX expression/);
});
