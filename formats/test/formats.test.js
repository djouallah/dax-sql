// The readers of formats/: TMSL (tmsl.js) and Apache Ossie (ossie.js, ossie-sql.js). On the
// contoso model (test/fixtures: calculated tables, calculation groups, a field parameter, roles,
// inactive and many-to-many relationships) and the aac one (conformance/models/aac):
//   - TMSL -> Ossie -> TMSL answers every query as the TMSL does, on DuckDB, over the data;
//   - a measure is SQL where it says the same there, and DAX where not;
//   - the POWER_BI extension holds only what something needs;
//   - conformance/models/aac/ossie.yaml is its model.bim as Ossie;
//   - a file written before (every TMSL property in the extension) reads as it did, and so does
//     a file of the spec before (custom_extensions, their data a JSON string);
//   - a measure made of two tables' measures is the model's, each as AGG(dataset.metric);
//   - AGG, source.column and ROUND read as DAX;
//   - an Ossie file whose metrics and fields are SQL reads as DAX;
//   - an Ossie metric comes back where it was, as the SQL it was written in while unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parse } from 'yaml';
import { DuckDBInstance } from '@duckdb/node-api';
import { createCompiler } from '../../src/index.js';
import { tmslToModel, directLakeTables, storageMode } from '../tmsl.js';
import { tmslToOssie, ossieToTmsl, ossieToModel, ossieSources, tmslType, OSSIE, fabricRefusals } from '../ossie.js';
import { metricDax } from '../ossie-sql.js';
import { readModel, formatOf } from '../model.js';
import { stringify } from 'yaml';
import { bim as contoso, setup as contosoData } from '../../test/fixtures/contoso.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/^﻿/, '');
const aac = JSON.parse(read('../../conformance/models/aac/model.bim'));
const roundTrip = bim => ossieToTmsl(parse(JSON.stringify(tmslToOssie(bim))));

const CONTOSO = [
  'EVALUATE SUMMARIZECOLUMNS(Product[Color], "s", [Sales Amount])',
  'EVALUATE SUMMARIZECOLUMNS(Category[Category], Customer[City], "s", [Sales Amount], "o", [Orders])',
  'EVALUATE ROW("u", CALCULATE([Sales Amount], USERELATIONSHIP(Sales[ShipDate], \'Date\'[Date])), "c", CALCULATE(COUNTROWS(Customer), CROSSFILTER(Sales[CustomerKey], Customer[CustomerKey], BOTH)))',
  'EVALUATE SUMMARIZECOLUMNS(\'Date\'[Year], \'Date\'[Month], "ytd", TOTALYTD([Sales Amount], \'Date\'[Date]))',
  'EVALUATE SUMMARIZECOLUMNS(Customer[City], "t", [Target])',
  'EVALUATE SUMMARIZECOLUMNS(\'Time Calc\'[Time Calc], "s", [Sales Amount])',
  'EVALUATE SUMMARIZECOLUMNS(Scale[Scale], \'Time Calc\'[Time Calc], "s", [Sales Amount])',
  'EVALUATE SUMMARIZECOLUMNS(\'Big Products\'[Name], "s", [Sales Amount])',
  'EVALUATE SUMMARIZECOLUMNS(Fields[Fields], "s", [Sales Amount])',
  'EVALUATE SUMMARIZECOLUMNS(Product[PriceBand], "v", SUM(Sales[LineValue]))',
];
const everyMeasure = (bim, by) => bim.model.tables.flatMap(t => (t.measures ?? []).flatMap(m =>
  [`EVALUATE ROW("v", [${m.name}])`, ...by.map(q => q(m.name))]));

// What a query answers on DuckDB: its rows in a fixed order, numbers to 9 digits (two ways of
// writing a measure may add up in another order), or its error.
async function answers(bim, setupDb, queries, options = {}) {
  const db = await DuckDBInstance.create(':memory:');
  const con = await db.connect();
  await setupDb(con);
  const dax = createCompiler(tmslToModel(bim), options);
  const value = v => (typeof v === 'bigint' ? Number(v)
    : v instanceof Date ? v.toISOString()
      : typeof v === 'number' ? Number(v.toPrecision(9))
        : v && typeof v === 'object' && 'toDouble' in v ? Number(v.toDouble().toPrecision(9)) : v);
  const out = [];
  for (const q of queries) {
    try {
      const rows = (await con.runAndReadAll(dax.compile(q).sql)).getRowsJS().map(r => JSON.stringify(r.map(value)));
      out.push({ q, rows: rows.sort() });
    } catch (e) {
      out.push({ q, error: e.code ?? 'ERROR' });
    }
  }
  con.closeSync?.();
  return out;
}

const contosoDb = con => con.run(contosoData);
// The aac model's tables, from conformance/models/aac/data, as the conformance adapter makes them.
async function aacDb(con) {
  const DUCK = { int64: 'BIGINT', double: 'DOUBLE', decimal: 'DECIMAL(18,4)', string: 'VARCHAR', boolean: 'BOOLEAN' };
  const s = x => `'${String(x).replace(/'/g, "''")}'`;
  const dir = new URL('../../conformance/models/aac/data/', import.meta.url);
  const files = new Set(readdirSync(dir));
  for (const t of aac.model.tables) {
    const name = t.partitions[0].source.entityName;
    if (!files.has(`${name}.csv`)) continue;
    const file = new URL(`${name}.csv`, dir);
    const body = readFileSync(file, 'utf8');
    const cols = t.columns.filter(c => !c.type || c.type === 'data');
    const types = cols.map(c => (c.dataType !== 'dateTime' ? DUCK[c.dataType] ?? 'VARCHAR' : /\d{4}-\d\d-\d\d[ T]\d/.test(body) ? 'TIMESTAMP' : 'DATE'));
    const columns = `{${cols.map((c, i) => `${s(c.sourceColumn ?? c.name)}: ${s(types[i])}`).join(', ')}}`;
    const path = decodeURIComponent(file.pathname).replace(/^\/([A-Za-z]:)/, '$1');
    await con.run(`CREATE TABLE "${name}" AS SELECT * FROM read_csv(${s(path)}, header = true, columns = ${columns}, nullstr = '', allow_quoted_nulls = false, quote = '"', escape = '"')`);
  }
}

test('contoso: TMSL -> Ossie -> TMSL answers as the TMSL, every measure, roles included', async () => {
  const queries = [...CONTOSO, ...everyMeasure(contoso, [
    m => `EVALUATE SUMMARIZECOLUMNS(Product[Color], 'Date'[Year], "v", [${m}])`,
    m => `EVALUATE CALCULATETABLE(SUMMARIZECOLUMNS(Customer[City], "v", [${m}]), Category[Category] = "Bikes")`,
  ])];
  const back = roundTrip(contoso);
  for (const roles of [undefined, 'Paris']) {
    const opts = roles ? { roles } : {};
    const [a, b] = await Promise.all([answers(contoso, contosoDb, queries, opts), answers(back, contosoDb, queries, opts)]);
    for (let i = 0; i < queries.length; i++) assert.deepEqual(b[i], a[i], queries[i]);
    assert.ok(a.filter(x => x.rows).length > queries.length / 2, 'most queries answer');
  }
});

test('aac: TMSL -> Ossie -> TMSL answers as the TMSL, every measure', async () => {
  const queries = everyMeasure(aac, [
    m => `EVALUATE SUMMARIZECOLUMNS(dim_region[Region], dim_calendar[month], "v", [${m}])`,
    m => `EVALUATE CALCULATETABLE(SUMMARIZECOLUMNS(dim_region[Region], "v", [${m}]), dim_duid[FuelSourceDescriptor] = "Wind")`,
  ]);
  const [a, b] = await Promise.all([answers(aac, aacDb, queries), answers(roundTrip(aac), aacDb, queries)]);
  for (let i = 0; i < queries.length; i++) assert.deepEqual(b[i], a[i], queries[i]);
  assert.ok(a.filter(x => x.rows).length > queries.length / 2, 'most queries answer');
});

const metricsOf = doc => [...doc.datasets.flatMap(d => (d.metrics ?? []).map(m => ({ ...m, dataset: d.name }))), ...(doc.metrics ?? [])];
const byName = doc => new Map(metricsOf(doc).map(m => [m.name, m]));
const extOf = o => o.nonportable_extensions?.[0].data ?? {};

test('a measure is SQL where it says the same there, DAX where not', () => {
  const m = byName(tmslToOssie(contoso));
  const sql = n => m.get(n).expression.sql;
  assert.equal(sql('Sales Amount'), 'SUM(Amount)');
  assert.equal(m.get('Sales Amount').dataset, 'Sales');
  assert.equal(sql('Orders'), 'NULLIF(COUNT(*), 0)');
  assert.equal(sql('Customers'), 'NULLIF(COUNT(DISTINCT CustomerKey) + MAX(CASE WHEN CustomerKey IS NULL THEN 1 ELSE 0 END), 0)');
  assert.equal(sql('Avg Price'), 'AVG(Price)');
  assert.equal(sql('Line Value Column'), 'SUM(LineValue)');
  // CALCULATE, time intelligence, RELATED, measures of two tables: DAX.
  for (const n of ['All Sales', 'Red Sales', 'Red Sales Kept', 'Sales YTD', 'Line Value', 'Best Customer Sales']) {
    assert.equal(m.get(n).expression.sql, undefined, n);
    assert.equal(m.get(n).expression.dialects[0].dialect, 'DAX', n);
  }
  // Named like a column of its table: the model's, its table in the extension.
  assert.equal(m.get('Target').dataset, undefined);
  assert.equal(extOf(m.get('Target')).table, 'CityTarget');
  // A ratio of two tables' measures: the model's, each measure evaluated where it is a metric.
  assert.equal(sql('Return Rate'), 'CAST(AGG(Returns.Returned) AS DOUBLE) / NULLIF(AGG(Sales.Quantity), 0)');
  assert.equal(m.get('Return Rate').dataset, undefined);
  assert.equal(extOf(m.get('Return Rate')).table, 'Sales');

  const a = byName(tmslToOssie(aac));
  assert.equal(a.get('Curtailment rate').expression.sql, 'CAST(100 * SUM(curtailed_mwh) AS DOUBLE) / NULLIF(SUM(available_mwh), 0)');
  // A fixed decimal divided by a number is one in DAX, rounded to four places; SQL's is not.
  assert.equal(a.get('Regional wind curtailed MWh').expression.sql, 'ROUND(SUM(wind_curtailed) / 12, 4)');
  assert.equal(a.get('Price at hour').expression.sql, 'ROUND(SUM(price * intervals) / NULLIF(SUM(intervals), 0), 4)');
  assert.equal(a.get('Registered units').expression.sql, 'NULLIF(COUNT(*), 0)');
  assert.equal(a.get('Average MW at hour').expression.sql, 'ROUND(AGG(fct_summary_hourly."Output MWh hourly") / NULLIF(AGG(dim_month."Month days"), 0), 4)');
  // The field date is DATE in OSSIE_SQL_2026 (a regular name, upper-cased; a quoted one matches
  // as written): a metric reads it as "DATE". Its own expression is the source's column, "date".
  assert.equal(a.get('Days with output').expression.sql, 'NULLIF(COUNT(DISTINCT "DATE") + MAX(CASE WHEN "DATE" IS NULL THEN 1 ELSE 0 END), 0)');
  const fctSummary = tmslToOssie(aac).datasets.find(d => d.name === 'fct_summary');
  assert.equal(fctSummary.fields.find(f => f.name === 'date').expression.sql, '"date"');
  assert.equal(metricDax(a.get('Days with output').expression.sql, fctSummary, tmslToOssie(aac).datasets).dax, "DISTINCTCOUNT('fct_summary'[date])");
  // IF, VAR, a two-argument MAX: DAX.
  for (const n of ['Demand MW', 'Generation MWh', 'Generation MW']) assert.equal(a.get(n).expression.sql, undefined, n);
});

test('the POWER_BI extension holds only what something needs', () => {
  const KEPT = new Set(['isHidden', 'formatString', 'formatStringDefinition', 'displayFolder', 'sortByColumn', 'isAvailableInMdx',
    'isNullable', 'extendedProperties', 'dataType', 'type', 'table', 'dataCategory', 'calculationGroup', 'hierarchies', 'partitions',
    'isActive', 'crossFilteringBehavior', 'fromCardinality', 'toCardinality', 'relyOnReferentialIntegrity',
    'securityFilteringBehavior', 'joinOnDateBehavior', 'model', 'partition']);
  for (const [name, bim] of [['contoso', contoso], ['aac', aac]]) {
    const doc = tmslToOssie(bim);
    const all = [doc, ...doc.datasets, ...doc.datasets.flatMap(d => [...d.fields, ...(d.metrics ?? [])]), ...(doc.relationships ?? []), ...(doc.metrics ?? [])];
    for (const o of all) for (const k of Object.keys(extOf(o))) assert.ok(KEPT.has(k), `${name}: ${o.name}: ${k}`);
    // No measure says its table when it sits on its table's dataset.
    for (const d of doc.datasets) for (const m of d.metrics ?? []) if (extOf(m).table) assert.notEqual(extOf(m).table, d.name);
    // Fields are the source column, in `sql`.
    for (const d of doc.datasets) for (const f of d.fields) assert.ok(f.expression.sql != null || f.expression.dialects[0].dialect === 'DAX', f.name);
  }
});

// A Direct Lake model of two tables, as Fabric gives one: lineage tags, annotations, a role's members.
const URL_ = 'Sql.Database("x", "y") // https://onelake.dfs.fabric.microsoft.com/00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000002';
const directLake = () => {
  const table = name => ({
    name, lineageTag: 'x', annotations: [{ name: 'a', value: 'b' }],
    columns: [{ name: 'id', dataType: 'int64', sourceColumn: 'id', lineageTag: 'y', summarizeBy: 'none', isKey: true }],
    partitions: [{ name, mode: 'directLake', source: { type: 'entity', entityName: name, schemaName: 'dbo', expressionSource: 'DatabaseQuery' } }],
  });
  return { name: 'dl', compatibilityLevel: 1604, model: {
    culture: 'en-US', defaultMode: 'directLake', annotations: [{ name: 'PBI', value: '1' }],
    tables: [table('a'), table('b')],
    expressions: [{ name: 'DatabaseQuery', kind: 'm', expression: URL_, lineageTag: 'z' }, { name: 'Unused', kind: 'm', expression: '1' }],
    roles: [{ name: 'r', modelPermission: 'read', members: [{ memberName: 'someone@example.com' }], tablePermissions: [{ name: 'a', filterExpression: 'a[id] = 1' }] }],
  } };
};

test('a Direct Lake model: one partition and its expression for the model, nothing per table', () => {
  const url = URL_;
  const doc = tmslToOssie(directLake());
  for (const d of doc.datasets) assert.equal(d.nonportable_extensions, undefined, d.name);
  for (const d of doc.datasets) for (const f of d.fields) assert.equal(f.nonportable_extensions, undefined, f.name);
  assert.deepEqual(extOf(doc), {
    model: { defaultMode: 'directLake', expressions: [{ name: 'DatabaseQuery', kind: 'm', expression: url }],
      roles: [{ name: 'r', tablePermissions: [{ name: 'a', filterExpression: 'a[id] = 1' }] }] },
    partition: { mode: 'directLake', expressionSource: 'DatabaseQuery' },
  });
  const back = ossieToTmsl(doc);
  assert.deepEqual(back.model.tables[0].partitions, [{ name: 'a', mode: 'directLake', source: { type: 'entity', entityName: 'a', schemaName: 'dbo', expressionSource: 'DatabaseQuery' } }]);
  assert.deepEqual(back.model.expressions, [{ name: 'DatabaseQuery', kind: 'm', expression: url }]);
  assert.deepEqual(back.model.tables[1].columns, [{ name: 'id', dataType: 'int64', sourceColumn: 'id', isKey: true }]);
});

test('a table named in full: the name is its source, with no partition or expression kept', () => {
  const name = t => `lakehouse."my ws".nem.dbo.${t.name}`;
  const doc = tmslToOssie(directLake(), 'dl', { source: name });
  assert.deepEqual(doc.datasets.map(d => d.source), ['lakehouse."my ws".nem.dbo.a', 'lakehouse."my ws".nem.dbo.b']);
  for (const d of doc.datasets) assert.equal(d.nonportable_extensions, undefined, d.name);
  // Left: the role alone. No expression, no partition, no storage mode.
  assert.deepEqual(extOf(doc), { model: { roles: [{ name: 'r', tablePermissions: [{ name: 'a', filterExpression: 'a[id] = 1' }] }] } });
  const back = ossieToTmsl(doc);
  assert.deepEqual(back.model.tables[0].partitions, [{ name: 'a', source: { type: 'entity', entityName: 'a', schemaName: 'lakehouse."my ws".nem.dbo' } }]);
  assert.equal(back.model.expressions, undefined);
  // One named, one not: the other keeps the model's partition, the named one does not take it.
  const mixed = tmslToOssie(directLake(), 'dl', { source: t => (t.name === 'a' ? name(t) : null) });
  assert.deepEqual(extOf(mixed).partition, { mode: 'directLake', expressionSource: 'DatabaseQuery' });
  const [a, b] = ossieToTmsl(mixed).model.tables.map(t => t.partitions[0]);
  assert.deepEqual(a, { name: 'a', source: { type: 'entity', entityName: 'a', schemaName: 'lakehouse."my ws".nem.dbo' } });
  assert.deepEqual(b, { name: 'b', mode: 'directLake', source: { type: 'entity', entityName: 'b', schemaName: 'dbo', expressionSource: 'DatabaseQuery' } });
});

test('aac: ossie.yaml is its model.bim as Ossie', () => {
  assert.deepEqual(parse(read('../../conformance/models/aac/ossie.yaml')), tmslToOssie(aac, 'aac'));
});

test('a file written before, every TMSL property in the extension, reads as it did', () => {
  // conformance/tools/aac/ossie.yaml is such a file, the source of models/aac/model.bim.
  const opts = { tableSource: t => `v_${t.name}` };
  const [a, b] = [tmslToModel(aac), ossieToModel(parse(read('../../conformance/tools/aac/ossie.yaml')))].map(m => createCompiler(m, opts));
  const measures = aac.model.tables.flatMap(t => (t.measures ?? []).map(m => m.name));
  assert.ok(measures.length > 40);
  for (const m of measures) for (const q of [`EVALUATE ROW("v", [${m}])`,
    `EVALUATE SUMMARIZECOLUMNS(dim_region[Region], dim_calendar[month], "v", [${m}])`]) {
    assert.equal(b.compile(q).sql, a.compile(q).sql, q);
  }
});

test('a file of the spec before, custom_extensions with their data a JSON string, reads the same', () => {
  const before = v => (Array.isArray(v) ? v.map(before)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => (k === 'nonportable_extensions'
      ? ['custom_extensions', x.map(e => ({ vendor_name: e.vendor_name, data: JSON.stringify(e.data) }))] : [k, before(x)])))
    : v);
  for (const bim of [contoso, aac]) {
    const doc = tmslToOssie(bim);
    const old = { ...before(doc), version: '0.2.0.dev0' };
    assert.ok(/"custom_extensions"/.test(JSON.stringify(old)) && !/"nonportable_extensions"/.test(JSON.stringify(old)));
    assert.deepEqual(ossieToTmsl(old), ossieToTmsl(doc));
    // Written again, it is the spec's of now.
    assert.deepEqual(tmslToOssie(ossieToTmsl(old), doc.name), doc);
  }
});

test('a metric with its SQL and its DAX side by side: the DAX is read, and both are written back', () => {
  const doc = {
    version: '0.3.0.dev0',
    name: 'shop',
    datasets: [
      { name: 'orders', source: 'sales.orders', fields: [{ name: 'amount', expression: { sql: 'amt' }, datatype: 'Decimal' }], metrics: [
        { name: 'total', expression: { sql: 'SUM(amt)', dialects: [{ dialect: 'DAX', expression: "SUM('orders'[amount]) + 0" }] } },
      ] },
      { name: 'returns', source: 'sales.returns', fields: [{ name: 'qty', expression: { sql: 'qty' }, datatype: 'Integer' }], metrics: [
        { name: 'returned', expression: { sql: 'SUM(qty)' } },
      ] },
    ],
    metrics: [
      { name: 'return rate', expression: { sql: 'AGG(returns.returned) / AGG(orders.total)', dialects: [{ dialect: 'DAX', expression: 'DIVIDE([returned], [total]) + 0' }] } },
    ],
  };
  const bim = ossieToTmsl(doc);
  const dax = Object.fromEntries(bim.model.tables.flatMap(t => (t.measures ?? []).map(m => [m.name, m.expression])));
  assert.deepEqual(dax, { total: "SUM('orders'[amount]) + 0", returned: "SUM('returns'[qty])", 'return rate': 'DIVIDE([returned], [total]) + 0' });
  const back = tmslToOssie(bim, 'shop');
  assert.deepEqual(back.datasets[0].metrics.map(m => [m.name, m.expression]), doc.datasets[0].metrics.map(m => [m.name, m.expression]));
  assert.deepEqual(back.metrics.map(m => [m.name, m.expression]), doc.metrics.map(m => [m.name, m.expression]));
  // The DAX changed in the model: the SQL kept beside it no longer says the same, so the SQL is the new DAX's.
  bim.model.tables.find(t => t.name === 'orders').measures.find(m => m.name === 'total').expression = "SUM('orders'[amount])";
  assert.deepEqual(tmslToOssie(bim, 'shop').datasets[0].metrics.find(m => m.name === 'total').expression,
    { sql: 'SUM(amount)' });
});

test('AGG(dataset.metric), source.column and ROUND read as DAX', () => {
  const doc = {
    version: '0.3.0.dev0',
    name: 'shop',
    datasets: [
      { name: 'orders', source: 'sales.orders', fields: [{ name: 'amount', expression: { sql: 'amt' }, datatype: 'Decimal' }], metrics: [
        { name: 'total', expression: { sql: 'SUM(source.amt)' } },
        { name: 'order count', expression: { sql: 'COUNT(*)' } },
      ] },
      { name: 'returns', source: 'sales.returns', fields: [{ name: 'qty', expression: { sql: 'qty' }, datatype: 'Integer' }], metrics: [
        { name: 'returned', expression: { sql: 'SUM(qty)' } },
      ] },
    ],
    metrics: [
      { name: 'average', expression: { sql: 'ROUND(AGG(orders.total) / AGG(orders."order count"), 2)' } },
      { name: 'return rate', expression: { sql: 'AGG(returns.returned) / NULLIF(AGG(orders."order count"), 0)' } },
    ],
  };
  const bim = ossieToTmsl(doc);
  const dax = Object.fromEntries(bim.model.tables.flatMap(t => (t.measures ?? []).map(m => [m.name, [t.name, m.expression]])));
  assert.deepEqual(dax, {
    total: ['orders', "SUM('orders'[amount])"],
    'order count': ['orders', "COUNTROWS('orders')"],
    returned: ['returns', "SUM('returns'[qty])"],
    average: ['orders', 'ROUND(DIVIDE([total], [order count]), 2)'],
    'return rate': ['returns', 'DIVIDE([returned], [order count])'],
  });
  // Back: each where it was, as it was written.
  const back = tmslToOssie(bim, 'shop');
  assert.deepEqual(back.metrics.map(m => [m.name, m.expression]), doc.metrics.map(m => [m.name, m.expression]));
  assert.deepEqual(back.datasets[0].metrics.map(m => [m.name, m.expression]), doc.datasets[0].metrics.map(m => [m.name, m.expression]));
  assert.ok(createCompiler(tmslToModel(bim)).compile('EVALUATE ROW("a", [average], "r", [return rate])').sql);
  // AGG is the model's alone, takes one dataset.metric and no FILTER; source.column is a declared field's column.
  // Each is left out, the model read without it, and onSkip says why.
  const refused = (where, sql) => {
    const d = JSON.parse(JSON.stringify(doc));
    (where === 'model' ? d.metrics : d.datasets[0].metrics).push({ name: 'x', expression: { sql } });
    const skipped = [];
    const out = ossieToTmsl(d, { onSkip: s => skipped.push(s) });
    const names = out.model.tables.flatMap(t => (t.measures ?? []).map(m => m.name));
    assert.ok(!names.includes('x') && names.includes('average'), sql);
    assert.equal(skipped.length, 1, sql);
    assert.equal(skipped[0].kind, 'metric');
    assert.equal(skipped[0].name, 'x');
    assert.match(skipped[0].why, /metric 'x' has no DAX expression, and its SQL is beyond what dax-sql reads/, sql);
  };
  refused('dataset', 'AGG(orders.total)');
  refused('model', 'AGG(orders.amount)');
  refused('model', 'AGG(orders.total) FILTER (WHERE orders.amount > 1)');
  refused('dataset', 'SUM(source.missing)');
});

test('an Ossie file whose metrics and fields are SQL reads as DAX', () => {
  const doc = {
    version: '0.3.0.dev0',
    name: 'shop',
    datasets: [
      { name: 'orders', source: 'sales.orders', primary_key: ['order_id'], fields: [
        { name: 'order_id', expression: { sql: 'o_id' }, datatype: 'Integer' },
        { name: 'customer_id', expression: { sql: 'customer_id' }, datatype: 'Integer' },
        { name: 'amount', expression: { sql: '"Amount"' }, datatype: 'Decimal' },
        { name: 'qty', expression: { sql: 'qty' }, datatype: 'Integer' },
        { name: 'double_amount', expression: { sql: '"Amount" * 2' }, datatype: 'Decimal' },
      ], metrics: [
        { name: 'order_count', expression: { sql: 'COUNT(*)' } },
        { name: 'avg_order', expression: { sql: 'SUM(amount) / COUNT(DISTINCT order_id)' } },
        { name: 'per_item', expression: { sql: 'SUM(amount * qty)' } },
      ] },
      { name: 'customers', source: 'sales.customers', primary_key: ['id'], fields: [{ name: 'id', expression: { sql: 'id' } }] },
    ],
    relationships: [{ name: 'orders_customers', from: 'orders', to: 'customers', from_columns: ['customer_id'], to_columns: ['id'] }],
    metrics: [{ name: 'revenue', expression: { sql: 'SUM(orders.amount)' } }],
  };
  const bim = ossieToTmsl(doc);
  const [orders] = bim.model.tables;
  const dax = Object.fromEntries(orders.measures.map(m => [m.name, m.expression]));
  assert.deepEqual(dax, {
    order_count: "COUNTROWS('orders')",
    avg_order: "DIVIDE(CONVERT(SUM('orders'[amount]), DOUBLE), DISTINCTCOUNTNOBLANK('orders'[order_id]))",
    per_item: "SUMX('orders', 'orders'[amount] * 'orders'[qty])",
    revenue: "SUM('orders'[amount])",
  });
  const col = n => orders.columns.find(c => c.name === n);
  assert.equal(col('amount').sourceColumn, 'Amount');
  assert.equal(col('order_id').sourceColumn, 'o_id');
  assert.deepEqual([col('double_amount').type, col('double_amount').expression], ['calculated', "'orders'[amount] * 2"]);
  assert.ok(createCompiler(tmslToModel(bim)).compile('EVALUATE SUMMARIZECOLUMNS(customers[id], "r", [revenue], "a", [avg_order])').sql);
});

test("an Ossie metric comes back where it was, as its SQL while its DAX is what that SQL read as", () => {
  const doc = {
    version: '0.3.0.dev0',
    name: 'm0',
    datasets: [{ name: 'sales', source: 'samples.sales.orders', fields: [
      { name: 'amount', expression: { sql: 'amount' }, datatype: 'Decimal' },
      { name: 'status', expression: { sql: 'status' }, datatype: 'String' },
      { name: 'qty', expression: { dialects: [{ dialect: 'ANSI_SQL', expression: 'qty' }] }, datatype: 'Integer' },
      { name: 'with_tax', expression: { dialects: [{ dialect: 'ANSI_SQL', expression: 'amount * 1.1' }] }, datatype: 'Decimal' },
    ], metrics: [
      { name: 'orders', expression: { sql: 'COUNT(sales.amount)' }, datatype: 'Integer' },
      { name: 'items', expression: { dialects: [{ dialect: 'ANSI_SQL', expression: 'SUM(qty)' }] } },
    ] }],
    metrics: [
      { name: 'total_amount', expression: { sql: 'SUM(amount)' }, datatype: 'Decimal' },
      { name: 'completed', expression: { sql: "SUM(CASE WHEN sales.status = 'completed' THEN sales.amount ELSE 0 END)" } },
    ],
  };
  const bim = ossieToTmsl(doc);
  const measure = n => bim.model.tables[0].measures.find(m => m.name === n);
  // A bare name in a model's own metric: the field one dataset has.
  assert.equal(measure('total_amount').expression, "SUM('sales'[amount])");
  // An ANSI_SQL expression is a calculated column, not a source column of that name.
  const withTax = bim.model.tables[0].columns.find(c => c.name === 'with_tax');
  assert.deepEqual([withTax.type, withTax.expression, withTax.sourceColumn], ['calculated', "'sales'[amount] * 1.1", undefined]);
  let back = tmslToOssie(bim, 'm0');
  assert.deepEqual(back.metrics.map(m => [m.name, m.expression.sql, m.datatype]), [
    ['total_amount', 'SUM(amount)', 'Decimal'],
    ['completed', "SUM(CASE WHEN sales.status = 'completed' THEN sales.amount ELSE 0 END)", undefined],
  ]);
  // Every expression as it was written, in its dialect.
  assert.deepEqual(back.datasets[0].metrics.map(m => [m.name, m.expression, m.datatype]),
    doc.datasets[0].metrics.map(m => [m.name, m.expression, m.datatype]));
  assert.deepEqual(back.datasets[0].fields.map(f => [f.name, f.expression]), doc.datasets[0].fields.map(f => [f.name, f.expression]));
  // Changed in Power BI: translated, no longer what it was read from.
  measure('total_amount').expression = "SUM('sales'[amount]) * 2";
  bim.model.tables[0].columns.find(c => c.name === 'with_tax').expression = "'sales'[amount] * 2";
  back = tmslToOssie(bim, 'm0');
  assert.notEqual(back.metrics[0].expression.sql, 'SUM(amount)');
  assert.notDeepEqual(back.datasets[0].fields.find(f => f.name === 'with_tax').expression, doc.datasets[0].fields[3].expression);
  assert.deepEqual(back.metrics.map(m => m.name), ['total_amount', 'completed']);
});

test('a metric with neither DAX nor SQL dax-sql reads is left out, saying why', () => {
  const doc = tmslToOssie(contoso);
  doc.metrics = [{ name: 'x', expression: { sql: 'MEDIAN(Sales.Amount)' } }];
  let skipped = [];
  const measures = d => ossieToTmsl(d, { onSkip: s => skipped.push(s) }).model.tables.flatMap(t => (t.measures ?? []).map(m => m.name));
  assert.ok(!measures(doc).includes('x'));
  assert.match(skipped[0].why, /metric 'x' has no DAX expression, and its SQL is beyond what dax-sql reads/);
  // A FILTER clause reads: the aggregate's X form over the rows it keeps.
  const sales = doc.datasets.find(d => d.name === 'Sales'), [f1, f2] = sales.fields.filter(f => /^[A-Za-z_]+$/.test(f.name));
  doc.metrics = [{ name: 'z', expression: { sql: `SUM(Sales.${f1.name}) FILTER (WHERE Sales.${f2.name} IS NOT NULL)` } }];
  const z = ossieToTmsl(doc).model.tables.flatMap(t => t.measures ?? []).find(m => m.name === 'z');
  assert.match(z.expression, /^SUMX\(FILTER\('Sales', NOT ISBLANK\('Sales'\[/);
  // Another engine's metric alone (a Databricks window, say) beside DAX ones: the model reads, without it.
  doc.metrics = [
    { name: 'y', expression: { dialects: [{ dialect: 'SNOWFLAKE', expression: 'SUM(a)' }] } },
    { name: 'w', expression: { dialects: [{ dialect: 'DAX', expression: 'COUNTROWS(Sales)' }, { dialect: 'DATABRICKS', expression: 'COUNT(1)' }] } },
  ];
  skipped = [];
  const names = measures(doc);
  assert.ok(names.includes('w') && !names.includes('y'));
  assert.deepEqual(skipped.map(s => [s.kind, s.name, s.dataset, s.why]), [['metric', 'y', null, "metric 'y' has no DAX expression and no SQL"]]);
  // No onSkip: left out all the same.
  assert.ok(!ossieToTmsl(doc).model.tables.flatMap(t => (t.measures ?? []).map(m => m.name)).includes('y'));
});

// A Fabric semantic view's folder of Ossie files (#11), parsed by the caller: merged as Fabric
// merges on publish, it reads as the one document it was split from.
test('Ossie: a folder of files reads as the document it was split from, merged as Fabric merges', () => {
  const doc = tmslToOssie(contoso);
  const { datasets, relationships, metrics, ...top } = doc;
  const head = { version: doc.version, name: doc.name };
  const half = Math.ceil(datasets.length / 2);
  const folder = {
    'a/model.yaml': top,
    'b/datasets/1.yaml': { ...head, datasets: datasets.slice(0, half) },
    'b/datasets/2.yaml': { ...head, datasets: datasets.slice(half) },
    'c/relationships.yaml': { ...head, relationships },
    ...(metrics ? { 'd/metrics/all.yaml': { ...head, metrics } } : {}),
    'e/old.yml': { ...head, datasets: [{ name: 'Ignored' }] },
  };
  assert.deepEqual(ossieToTmsl(folder), ossieToTmsl(doc));
  assert.deepEqual(ossieToModel(folder).tables.size, ossieToModel(doc).tables.size);
  const input = (files, re) => assert.throws(() => ossieToTmsl(files), e => e.code === 'INPUT' && re.test(e.message), re);
  // A name defined twice, in two files: both named. A metric's name in any case.
  input({ ...folder, 'f/again.yaml': { ...head, datasets: [datasets[0]] } }, new RegExp(`dataset ${datasets[0].name} is in b/datasets/1\.yaml and f/again\.yaml`));
  if (metrics) input({ ...folder, 'f/m.yaml': { ...head, metrics: [{ ...metrics[0], name: metrics[0].name.toUpperCase() }] } }, /metric .* is in d\/metrics\/all\.yaml and f\/m\.yaml/);
  input({ ...folder, 'f/x.yaml': { name: doc.name, datasets: [] } }, /f\/x\.yaml has no version/);
  input({ ...folder, 'f/x.yaml': { ...head, description: 'another' }, 'a/model.yaml': { ...top, description: 'one' } }, /description differs/);
  input({ 'model.yaml': 'version: 1' }, /is text: parse its YAML first/);
  input({ 'old.yml': head }, /no \.yaml file/);
});

// Where a Direct Lake model's tables are (#13): by GUIDs from a shared expression, or by name in
// the model's workspace (an Ossie source item.schema.table); and how the model stores them.
test('directLakeTables and storageMode read where a model\'s data is from its TMSL alone', () => {
  const ws = '11111111-2222-3333-4444-555555555555', lh = 'AAAAAAAA-2222-3333-4444-555555555555';
  const bim = { model: {
    defaultMode: 'directLake',
    expressions: [{ name: 'DatabaseQuery', expression: ['let', `database = AzureStorage.DataLake("https://onelake.dfs.fabric.microsoft.com/${ws}/${lh}", [HierarchicalNavigation=true])`, 'in database'] }],
    tables: [
      { name: 'Sales', partitions: [{ mode: 'directLake', source: { type: 'entity', expressionSource: 'DatabaseQuery', schemaName: 'gold', entityName: 'fact_sales' } }] },
      { name: 'Dim', partitions: [{ source: { type: 'entity', expressionSource: 'DatabaseQuery' } }] },
      { name: 'V', partitions: [{ source: { type: 'entity', schemaName: '"my lh".dbo', entityName: 'v' } }] },
      { name: 'Bare', partitions: [{ source: { type: 'entity', schemaName: 'dbo', entityName: 'b' } }] },
      { name: 'Calc', partitions: [{ source: { type: 'calculated', expression: '{1}' } }] },
    ] } };
  assert.deepEqual([...directLakeTables(bim)], [
    ['sales', { workspace: ws, item: lh.toLowerCase(), schema: 'gold', entity: 'fact_sales' }],
    ['dim', { workspace: ws, item: lh.toLowerCase(), schema: 'dbo', entity: 'Dim' }],
    ['v', { item: 'my lh', schema: 'dbo', entity: 'v', inWorkspace: true }],
  ]);
  assert.equal(storageMode(bim), 'directlake');
  assert.equal(storageMode(bim.model), 'directlake', 'the model itself too');
  assert.equal(storageMode({ model: { tables: [{ partitions: [{}] }] } }), 'import', 'no mode: import');
  assert.equal(storageMode({ model: { tables: [{ partitions: [{ mode: 'directQuery' }] }, { partitions: [{ mode: 'import' }] }] } }), 'composite');
  assert.equal(storageMode({ model: { defaultMode: 'dual', tables: [{ partitions: [{ mode: 'default' }] }] } }), 'dual');
});

// One reader for a model's file or folder (#14): the format its path says, a BOM dropped, the
// caller's YAML parser for Ossie, INPUT errors naming the file.
test('readModel reads a .bim, a .tmdl, an Ossie .yaml and a folder of either, and says what it cannot', () => {
  const bom = '﻿';
  const input = (f, re) => assert.throws(f, e => e.code === 'INPUT' && re.test(e.message), re);
  // TMSL, with Visual Studio's BOM.
  assert.deepEqual(readModel('m.bim', bom + JSON.stringify(contoso)), { bim: contoso, skipped: [] });
  input(() => readModel('m.bim', '{ not json'), /m\.bim is not a TMSL model/);
  // TMDL: a file, and a folder (only its .tmdl files read).
  const tmdl = 'model Model\n\tculture: en-US\n\ntable Sales\n\tmeasure Total = SUM(Sales[Amount])\n\tcolumn Amount\n\t\tdataType: double\n\t\tsourceColumn: Amount\n';
  const one = readModel('m.tmdl', bom + tmdl).bim;
  assert.equal(one.model.tables[0].name, 'Sales');
  assert.deepEqual(readModel('def', { 'model.tmdl': 'model Model\n\tculture: en-US\n', 'tables/Sales.tmdl': tmdl.split('\n\n')[1], 'README.md': '# not read' }).bim.model.tables[0].measures[0].name, 'Total');
  // Ossie: parsed by the caller's parser; one document, and a folder of .yaml files.
  const doc = tmslToOssie(contoso);
  const fromDoc = ossieToTmsl(doc);
  assert.deepEqual(readModel('m.ossie.yaml', bom + stringify(doc), { parseYaml: parse }).bim, fromDoc);
  const { datasets, relationships, ...top } = doc, head = { version: doc.version, name: doc.name };
  const folder = { 'model.yaml': stringify(top), 'ds.yaml': stringify({ ...head, datasets }), 'rels.yaml': stringify({ ...head, relationships }), 'old.yml': 'not: read' };
  assert.deepEqual(readModel('Semantic Views/m', folder, { parseYaml: parse }).bim.model.tables.length, fromDoc.model.tables.length);
  input(() => readModel('m.yaml', stringify(doc)), /parses with the caller's parseYaml/);
  input(() => readModel('m.yaml', 'a: [', { parseYaml: parse }), /m\.yaml is not YAML/);
  input(() => readModel('m.yaml', 'a: 1', { parseYaml: parse }), /m\.yaml is not an Apache Ossie model: YAML with no datasets/);
  // Metrics dax-sql cannot read are skipped and said; a model left with none is refused.
  const other = { version: doc.version, name: 'o', datasets: [{ name: 't', source: 'dbo.t', fields: [{ name: 'x', expression: { sql: 'x' } }],
    metrics: [{ name: 'm', expression: { dialects: [{ dialect: 'SNOWFLAKE', expression: 'SUM(x)' }] } }] }] };
  input(() => readModel('o.yaml', stringify(other), { parseYaml: parse }), /o\.yaml: none of its metrics can be read: metric 'm'/);
  // What is no model.
  input(() => readModel('m.csv', 'a,b'), /m\.csv: a model is read from/);
  input(() => readModel('dir', { 'a.txt': 'x' }), /the folder has no \.tmdl or \.yaml file/);
  input(() => readModel('dir', [1]), /a model is a file's text, or a folder/);
});

// What a Fabric semantic view leaves to the platform (#20): a dataset's columns when it lists no
// fields, and the lakehouse a source named schema.table alone is read in.
test('ossieToTmsl: a dataset with no fields has its source\'s columns (columnsOf), and a schema.table source the catalog\'s', () => {
  const doc = { version: '0.3.0.dev0', name: 'v', datasets: [
    { name: 'sales', source: 'dbo.sales', primary_key: ['id'], metrics: [{ name: 'Total', expression: { sql: 'SUM(amount)' } }] },
    { name: 'cust', source: 'customers', fields: [{ name: 'cid', expression: { sql: 'cid' }, datatype: 'Integer' }] },
    { name: 'dim', source: 'lh.dbo.dim' },
  ], relationships: [{ name: 'r', from: 'sales', from_columns: ['cust_id'], to: 'cust', to_columns: ['cid'] }] };
  assert.deepEqual(ossieSources(doc), [{ dataset: 'sales', source: 'dbo.sales' }, { dataset: 'dim', source: 'lh.dbo.dim' }]);
  const asked = [], skipped = [];
  const columns = { sales: [{ name: 'id', type: 'BIGINT' }, { name: 'amount', type: 'DECIMAL(18,2)' }, { name: 'at', type: 'TIMESTAMP WITH TIME ZONE' }, { name: 'cust_id', type: 'long' }, { name: 'tags', type: 'VARCHAR[]' }, { name: 'meta', type: 'STRUCT(a INT)' }] };
  const bim = ossieToTmsl(doc, { catalog: 'nem', columnsOf: s => { asked.push(s); return columns[s.dataset] ?? null; }, onSkip: s => skipped.push(s) });
  assert.deepEqual(asked, ossieSources(doc), 'asked of the datasets with no fields');
  const t = n => bim.model.tables.find(x => x.name === n);
  assert.deepEqual(t('sales').columns.map(c => [c.name, c.dataType, c.sourceColumn, !!c.isKey]),
    [['id', 'int64', 'id', true], ['amount', 'decimal', 'amount', false], ['at', 'dateTime', 'at', false], ['cust_id', 'int64', 'cust_id', false]]);
  assert.deepEqual(skipped.map(s => [s.kind, s.dataset, s.name]), [['field', 'sales', 'tags'], ['field', 'sales', 'meta']]);
  // schema.table alone, and table alone: in the catalog; one named in full stays where it says.
  assert.equal(t('sales').partitions[0].source.schemaName, '"nem"."dbo"');
  assert.equal(t('cust').partitions[0].source.schemaName, '"nem"."dbo"');
  assert.equal(t('dim').partitions[0].source.schemaName, 'lh.dbo');
  // No columnsOf (or null): the key and relationship columns as text, so the model holds.
  const bare = ossieToTmsl(doc);
  assert.deepEqual(bare.model.tables[0].columns.map(c => [c.name, c.dataType]), [['id', 'string'], ['cust_id', 'string']]);
  assert.equal(bare.model.tables[0].partitions[0].source.schemaName, 'dbo', 'no catalog: as before');
  createCompiler(tmslToModel(bare)).compile('EVALUATE ROW("n", COUNTROWS(sales))');
  assert.ok(createCompiler(tmslToModel(bim)).compile('EVALUATE ROW("t", [Total])').sql, 'its metric reads a column columnsOf gave');
  assert.match(createCompiler(tmslToModel(bim)).compile('EVALUATE dim').sql, /FROM "lh"."dbo"."dim"/, 'a schema of a path, each name its own');
  // The engine's type names.
  const want = { BIGINT: 'int64', HUGEINT: 'int64', integer: 'int64', 'DOUBLE': 'double', real: 'double', 'NUMERIC(10,2)': 'decimal', BOOLEAN: 'boolean', date: 'dateTime', datetime2: 'dateTime', 'VARCHAR(20)': 'string', uuid: 'string', BLOB: null, 'MAP(VARCHAR, INT)': null, INTERVAL: null };
  for (const [k, v] of Object.entries(want)) assert.equal(tmslType(k), v, k);
  assert.throws(() => ossieToTmsl(doc, { columnsOf: 'x' }), e => e.code === 'INPUT');
});

// A Fabric semantic view read as Fabric's Publish reads it (#25): lenient, its metrics in Metrics.
test("ossieToTmsl as 'fabric': a semantic view as the model Fabric's Publish makes of it, what it left out said", () => {
  const dax = e => ({ dialects: [{ dialect: 'DAX', expression: e }] });
  const files = {
    'datasets.yaml': { version: '0.2.0.dev0', name: 'nem', description: 'NEM', datasets: [
      { name: 'sales', source: 'dbo.sales', fields: [{ name: 'ignored' }], metrics: [{ name: 'Own', expression: dax('1') }] },
      { name: 'cust', source: 'dbo.customers' },
      { name: 'CUST', source: 'dbo.other' },
      { name: 'far', source: 'lh.dbo.far' },
    ] },
    'relationships.yaml': { version: '0.3.0.dev0', name: 'nem', relationships: [
      { name: 'r', from: 'Sales', from_columns: ['cust_id'], to: 'cust', to_columns: ['cid'] },
      { name: 'R', from: 'sales', from_columns: ['cust_id'], to: 'cust', to_columns: ['cid'] },
      { name: 'two', from: 'sales', from_columns: ['a', 'b'], to: 'cust', to_columns: ['c', 'd'] },
      { name: 'lost', from: 'sales', from_columns: ['x'], to: 'far', to_columns: ['y'] },
    ] },
    'metrics.yaml': { version: '0.2.0.dev0', name: 'nem', metrics: [
      { name: 'Total', description: 'all of it', expression: dax('SUM(sales[amount])') },
      { name: 'total', expression: dax('0') },
      { name: 'Cust', expression: dax('1') },
      { name: 'SqlOnly', expression: { dialects: [{ dialect: 'OSSIE_SQL_2026', expression: 'SUM(amount)' }] } },
    ] },
    'notes.yml': { version: '9' },
  };
  const columns = { sales: [{ name: 'cust_id', type: 'BIGINT' }, { name: 'amount', type: 'DECIMAL(18,2)' }, { name: 'tags', type: 'VARCHAR[]' }],
    cust: [{ name: 'cid', type: 'long' }, { name: 'name', type: 'VARCHAR' }] };
  const asked = [], skipped = [];
  const columnsOf = s => { asked.push(s); return columns[s.dataset] ?? []; };
  assert.deepEqual(ossieSources(files, { as: 'fabric' }), [{ dataset: 'sales', source: 'dbo.sales' }, { dataset: 'cust', source: 'dbo.customers' }]);
  const bim = ossieToTmsl(files, { as: 'fabric', catalog: 'nem', columnsOf, onSkip: s => skipped.push(s) });
  assert.deepEqual(asked, ossieSources(files, { as: 'fabric' }), 'every dataset kept, its fields or not');
  assert.equal(bim.name, 'nem');
  assert.equal(bim.model.description, 'NEM');
  assert.deepEqual(bim.model.tables.map(t => t.name), ['sales', 'cust', 'Metrics']);
  const sales = bim.model.tables[0];
  assert.deepEqual(sales.columns.map(c => [c.name, c.dataType, c.sourceColumn]), [['cust_id', 'int64', 'cust_id'], ['amount', 'decimal', 'amount']]);
  assert.deepEqual(sales.partitions, [{ name: 'sales', mode: 'directLake', source: { type: 'entity', entityName: 'sales', schemaName: '"nem"."dbo"' } }]);
  assert.deepEqual(bim.model.tables[2].measures, [{ name: 'Total', description: 'all of it', expression: 'SUM(sales[amount])' }]);
  assert.deepEqual(bim.model.relationships, [{ name: 'r', fromTable: 'sales', fromColumn: 'cust_id', toTable: 'cust', toColumn: 'cid' }]);
  assert.deepEqual(skipped.map(s => [s.kind, s.name, s.file]), [
    ['dataset', 'CUST', 'datasets.yaml'], ['dataset', 'far', 'datasets.yaml'], ['metric', 'Own', 'datasets.yaml'],
    ['relationship', 'R', 'relationships.yaml'], ['relationship', 'two', 'relationships.yaml'], ['relationship', 'lost', 'relationships.yaml'],
    ['metric', 'total', 'metrics.yaml'], ['metric', 'Cust', 'metrics.yaml'], ['metric', 'SqlOnly', 'metrics.yaml'],
    ['field', 'tags', null],
  ]);
  assert.ok(skipped.every(s => typeof s.why === 'string' && s.why.includes(s.name)));
  const { sql } = createCompiler(tmslToModel(bim)).compile('EVALUATE SUMMARIZECOLUMNS(cust[name], "t", [Total])');
  assert.match(sql, /"nem"\."dbo"\."sales"/);
  // readModel: a folder's texts, a Fabric view's whose metrics are all left out still opens.
  const texts = Object.fromEntries(Object.entries(files).map(([p, d]) => [p, stringify(d)]));
  assert.deepEqual(readModel('Semantic Views/nem', texts, { parseYaml: parse, as: 'fabric', catalog: 'nem', columnsOf: s => columns[s.dataset] ?? [] }).bim, bim);
  const noDax = { 'm.yaml': { version: '0.2.0.dev0', name: 'v', datasets: [{ name: 'sales', source: 'dbo.sales' }], metrics: [{ name: 'S', expression: { sql: 'SUM(amount)' } }] } };
  assert.equal(readModel('v', Object.fromEntries(Object.entries(noDax).map(([p, d]) => [p, stringify(d)])), { parseYaml: parse, as: 'fabric', columnsOf: () => columns.sales }).skipped.map(x => x.name).join(), 'S,tags');
  // What leaves nothing to open: another version, a dataset with no columns, no columnsOf, a bad as.
  const input = (f, re) => assert.throws(f, e => e.code === 'INPUT' && re.test(e.message), re);
  input(() => ossieToTmsl({ ...files, 'x.yaml': { version: '0.1', name: 'nem' } }, { as: 'fabric', columnsOf }), /x\.yaml is version 0\.1: a Fabric semantic view is 0\.2\.0\.dev0 or 0\.3\.0\.dev0/);
  input(() => ossieToTmsl(files, { as: 'fabric', columnsOf: s => (s.dataset === 'cust' ? [] : columns.sales) }), /the dataset cust: its source dbo\.customers/);
  input(() => ossieToTmsl(files, { as: 'fabric' }), /as 'fabric' reads each dataset's columns by columnsOf/);
  input(() => ossieToTmsl(files, { as: 'Fabric', columnsOf }), /as is 'fabric'/);
  // Not given: the strict reader, as before.
  input(() => ossieToTmsl(files), /dataset CUST is in datasets\.yaml|metric total is in/);
});

// What Fabric's Publish refuses, by where it is (#27), against what it reads (#29).
test("fabricRefusals: what Fabric's Publish refuses in a view, by file and path; onSkip says the path too", () => {
  const dax = e => ({ dialects: [{ dialect: 'DAX', expression: e }] });
  const files = {
    'a.yaml': { version: '0.3.0.dev0', name: 'v', datasets: [
      { name: 'sales', source: 'dbo.sales', fields: [{ name: 'x', expression: { dialects: [{ dialect: 'OSSIE_SQL_2026', expression: 'x' }] } }] },
      { name: 'cust', source: 'lh.dbo.customers' },
    ], nonportable_extensions: [{ vendor_name: 'POWER_BI', data: {} }] },
    'b.yaml': { version: '0.2.0.dev0', name: 'v', datasets: [{ name: 'SALES', source: 'dbo.other' }],
      relationships: [{ name: 'r', from: 'sales', from_columns: ['a', 'b'], to: 'cust', to_columns: ['c'], description: 'd' }],
      metrics: [{ name: 'Total', expression: dax('1') }, { name: 'cust', expression: { dialects: [] } }, { name: 'S', expression: { dialects: [{ dialect: 'ANSI_SQL', expression: 'SUM(x)' }] } }] },
    'c.yaml': { version: '0.2.0.dev0', name: 'v', datasets: [] },
  };
  const got = fabricRefusals(files).map(r => [r.file, r.path.join('/')]);
  assert.deepEqual(got, [
    ['a.yaml', 'version'], ['a.yaml', 'datasets/0/fields/0/expression/dialects/0/dialect'], ['a.yaml', 'nonportable_extensions'],
    ['b.yaml', 'metrics/1/expression/dialects'],
    ['c.yaml', 'datasets'],
    ['b.yaml', 'datasets/0/name'],
    ['a.yaml', 'datasets/1/source'],
    ['b.yaml', 'relationships/0/from_columns'], ['b.yaml', 'relationships/0/to'], ['b.yaml', 'relationships/0/description'],
    ['b.yaml', 'metrics/1/name'],
  ]);
  assert.ok(fabricRefusals(files).every(r => typeof r.why === 'string' && /Publish/.test(r.why)));
  // ANSI_SQL is a name Publish knows (and leaves out): not refused. A view it takes: none.
  assert.deepEqual(fabricRefusals({ 'v.yaml': { version: '0.2.0.dev0', name: 'v', datasets: [{ name: 'sales', source: 'dbo.sales' }],
    metrics: [{ name: 'S', expression: { dialects: [{ dialect: 'ANSI_SQL', expression: 'SUM(x)' }, { dialect: 'DAX', expression: '1' }] } }] } }), []);
  // onSkip: the same paths, where the model leaves a part out.
  const skipped = [];
  ossieToTmsl(files, { as: 'fabric', columnsOf: () => [{ name: 'a', type: 'BIGINT' }], onSkip: s => skipped.push(s) });
  assert.deepEqual(skipped.filter(s => s.kind !== 'field').map(s => [s.file, s.path.join('/')]), [
    ['b.yaml', 'datasets/0/name'], ['a.yaml', 'datasets/1/source'], ['b.yaml', 'relationships/0/from_columns'],
    ['b.yaml', 'metrics/1/expression'], ['b.yaml', 'metrics/2/expression'],
  ]);
  // What Publish reads, said beside what dax-sql reads.
  assert.equal(OSSIE.dialects.standard, 'OSSIE_SQL_2026');
  assert.equal(OSSIE.publish.version, '0.2.0.dev0');
  assert.deepEqual([...OSSIE.publish.reads], ['DAX']);
  assert.ok(OSSIE.publish.dialects.includes('ANSI_SQL') && !OSSIE.publish.dialects.includes('OSSIE_SQL_2026'));
  assert.ok(Object.isFrozen(OSSIE.publish) && Object.isFrozen(OSSIE.publish.dialects));
});

// A quoted table name (#28): TMSL's entityName is the name itself, and so is directLakeTables'.
test('a source\'s quoted table name is its name in TMSL, quoted again as Ossie and as SQL', () => {
  const doc = { version: '0.3.0.dev0', name: 'v', datasets: [
    { name: 'duid', source: '"my lake".dbo."DUID list"', fields: [{ name: 'id', datatype: 'Integer', expression: { sql: 'id' } }] }] };
  const bim = ossieToTmsl(doc);
  assert.deepEqual(bim.model.tables[0].partitions[0].source, { type: 'entity', entityName: 'DUID list', schemaName: '"my lake".dbo' });
  assert.deepEqual(directLakeTables(bim).get('duid'), { item: 'my lake', schema: 'dbo', entity: 'DUID list', inWorkspace: true });
  assert.equal(tmslToOssie(bim, 'v').datasets[0].source, '"my lake".dbo."DUID list"');
  assert.match(createCompiler(tmslToModel(bim)).compile('EVALUATE duid').sql, /FROM "my lake"\."dbo"\."DUID list" AS/);
  // A TMSL written with the quotes kept (dax-sql before): read the same.
  const old = { model: { tables: [{ name: 'duid', partitions: [{ source: { type: 'entity', entityName: '"DUID list"', schemaName: '"my lake".dbo' } }] }] } };
  assert.deepEqual(directLakeTables(old).get('duid'), { item: 'my lake', schema: 'dbo', entity: 'DUID list', inWorkspace: true });
});

// What the reader is written for, said: the spec's version and commit, the versions and dialects.
test('OSSIE: the spec version, the Ossie commit checked, what is read; another version refused', () => {
  assert.equal(tmslToOssie(contoso).version, OSSIE.version);
  assert.match(OSSIE.commit, /^[0-9a-f]{40}$/);
  assert.deepEqual([...OSSIE.reads], ['0.3.0.dev0', '0.2.0.dev0']);
  assert.deepEqual([...OSSIE.fabric], ['0.2.0.dev0', '0.3.0.dev0']);
  assert.deepEqual([...OSSIE.dialects.writes], ['DAX', 'OSSIE_SQL_2026']);
  assert.ok(Object.isFrozen(OSSIE) && Object.isFrozen(OSSIE.reads) && Object.isFrozen(OSSIE.dialects.reads));
  const doc = tmslToOssie(contoso);
  for (const v of OSSIE.reads) ossieToTmsl({ ...doc, version: v });
  const input = (f, re) => assert.throws(f, e => e.code === 'INPUT' && re.test(e.message), re);
  input(() => ossieToTmsl({ ...doc, version: '0.4.0.dev0' }), /the document is Ossie version 0.4.0.dev0: dax-sql reads 0.3.0.dev0 and 0.2.0.dev0$/);
  input(() => ossieToTmsl({ version: '0.1.1', semantic_model: [] , datasets: [] }), /version 0.1.1: .*OSI 0.1, a list of semantic_model/);
  input(() => ossieToTmsl({ 'a.yaml': { ...doc, version: '1.0' } }), /Ossie folder: a.yaml is Ossie version 1.0/);
  input(() => readModel('m.yaml', stringify({ ...doc, version: '1.0' }), { parseYaml: parse }), /version 1.0/);
});

// A model's format from its text (#23), no parse: what a host sniffs before reading a file.
test('formatOf: a model file\'s format from its path and text, null for what is no model', () => {
  const tmdl = 'model Model\n\tculture: en-US\n\ntable Sales\n\tcolumn Amount\n\t\tdataType: double\n';
  assert.equal(formatOf('m.bim', JSON.stringify(contoso)), 'tmsl');
  assert.equal(formatOf('m.json', JSON.stringify(contoso)), 'tmsl', 'by its text');
  assert.equal(formatOf('m.ossie.yaml', stringify(tmslToOssie(contoso))), 'ossie');
  assert.equal(formatOf('schema.yml', 'version: 2\nmodels:\n  - name: x\n'), null, 'a dbt schema.yml');
  assert.equal(formatOf('m.tmdl', tmdl), 'tmdl');
  assert.equal(formatOf('m.tmdl', 'createOrReplace\n\tdatabase X\n\t\tmodel Model\n\t\t\ttable T\n'), 'tmdl');
  assert.equal(formatOf('tables/Sales.tmdl', tmdl.split('\n\n')[1]), null, 'one table of a project folder');
  assert.equal(formatOf('model.tmdl', 'model Model\n\tculture: en-US\n'), null, 'the model\'s settings alone');
  assert.equal(formatOf('notes.txt', 'hello'), null);
  // readModel says which: one file of a project, YAML that is no model.
  assert.throws(() => readModel('tables/Sales.tmdl', tmdl.split('\n\n')[1]), e => e.code === 'INPUT' && /one file of a Power BI project/.test(e.message));
  assert.equal(readModel('model.json', JSON.stringify(contoso)).bim.name, contoso.name, 'any path, by its text');
});
