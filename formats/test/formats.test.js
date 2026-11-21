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
import { tmslToModel } from '../tmsl.js';
import { tmslToOssie, ossieToTmsl, ossieToModel } from '../ossie.js';
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
