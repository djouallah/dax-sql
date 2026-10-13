// Builds models/edges: a small model whose data and relationships are deliberately awkward, so an
// engine whose fixes only hold for the patterns model's shapes shows it. model.bim and
// data/<Table>.csv, from fixed and seeded rows (data.js) and the measures (measures.js).
//
//   Sales -> Product          Target <-> Product on Brand (many-to-many, Product filters Target)
//   Sales <-> Customer        (many-to-one, both directions)
//   Sales -> Store -> Country -> Region            (3-level snowflake)
//   Target -> Store           StoreProfile <-> Store (one-to-one)
//   Sales -> Date by Order Date (active), by Ship Date (inactive)    Target -> Date
//   Adjust: a calculation group (precedence 10)    roles Retail (Customer), Europe (Region)
//
//   node tools/edges/build.mjs
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { csv } from '../csv.mjs';
import { generate } from './data.js';
import MEASURES from './measures.js';

const data = generate();

// Extra column properties, and the calculated columns, by table.
const COLUMN_EXTRA = {
  Date: { Date: { isKey: true }, 'Month Name': { sortByColumn: 'Month' }, 'Day Name': { sortByColumn: 'Weekday' } },
  Region: { RegionKey: { isKey: true } },
  Country: { CountryKey: { isKey: true } },
  Store: { StoreKey: { isKey: true } },
  StoreProfile: { StoreKey: { isKey: true } },
  Product: { ProductKey: { isKey: true } },
  Customer: { CustomerKey: { isKey: true } },
};
const CALCULATED = {
  Sales: [
    ['Line Amount', 'double', 'Sales[Quantity] * Sales[Unit Price]'],
    // RELATED across the whole snowflake; blank for a store Store lacks.
    ['Store Region', 'string', 'RELATED(Region[Region])'],
  ],
  Product: [
    // Context transition: blank for the product nothing sold.
    ['Units Sold', 'int64', 'CALCULATE(SUM(Sales[Quantity]))'],
  ],
};
const TABLE_EXTRA = { Date: { dataCategory: 'Time' } };

const calcGroup = (name, precedence, items) => ({
  name,
  calculationGroup: { precedence, calculationItems: items.map(([n, expression], ordinal) => ({ name: n, expression, ordinal })) },
  columns: [{ name, dataType: 'string', sourceColumn: 'Name', sortByColumn: 'Ordinal' }, { name: 'Ordinal', dataType: 'int64', sourceColumn: 'Ordinal' }],
  partitions: [{ name: `${name} Partition`, source: { type: 'calculationGroup' } }],
});

function rel(fromTable, fromColumn, toTable, toColumn, extra = {}) {
  const name = `${fromTable}_${fromColumn}_${toTable}`.replace(/\W+/g, '_');
  return { name, fromTable, fromColumn, toTable, toColumn, ...extra };
}

function build(partition) {
  const tables = Object.entries(data).map(([name, t]) => ({
    name,
    ...TABLE_EXTRA[name],
    columns: [
      ...t.columns.map(([c, dataType]) => ({ name: c, dataType, sourceColumn: c, ...COLUMN_EXTRA[name]?.[c] })),
      ...(CALCULATED[name] ?? []).map(([c, dataType, expression]) => ({ name: c, dataType, type: 'calculated', expression })),
    ],
    measures: MEASURES.filter(m => m[0] === name).map(([, n, expression]) => ({ name: n, expression })),
    partitions: [partition(name, t)],
  }));
  tables.push(calcGroup('Adjust', 10, [
    ['Current', 'SELECTEDMEASURE()'],
    ['PY', "CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR('Date'[Date]))"],
    ['YTD', "CALCULATE(SELECTEDMEASURE(), DATESYTD('Date'[Date]))"],
    ['Shipped', "CALCULATE(SELECTEDMEASURE(), USERELATIONSHIP(Sales[Ship Date], 'Date'[Date]))"],
    ['Per Customer', 'IF(ISSELECTEDMEASURE([Sales Amount], [Margin], [Total Quantity]), DIVIDE(SELECTEDMEASURE(), [Customers No Blank]), SELECTEDMEASURE())'],
  ]));
  for (const t of tables) if (!t.measures?.length) delete t.measures;
  return {
    name: 'dax-conformance-edges',
    compatibilityLevel: 1604,
    model: {
      culture: 'en-US',
      discourageImplicitMeasures: true,
      defaultPowerBIDataSourceVersion: 'powerBI_V3',
      tables,
      relationships: [
        rel('Sales', 'ProductKey', 'Product', 'ProductKey'),
        rel('Sales', 'CustomerKey', 'Customer', 'CustomerKey', { crossFilteringBehavior: 'bothDirections' }),
        rel('Sales', 'StoreKey', 'Store', 'StoreKey'),
        rel('Store', 'CountryKey', 'Country', 'CountryKey'),
        rel('Country', 'RegionKey', 'Region', 'RegionKey'),
        rel('Sales', 'Order Date', 'Date', 'Date'),
        rel('Sales', 'Ship Date', 'Date', 'Date', { isActive: false }),
        rel('Target', 'Date', 'Date', 'Date'),
        rel('Target', 'StoreKey', 'Store', 'StoreKey'),
        rel('Target', 'Brand', 'Product', 'Brand', { fromCardinality: 'many', toCardinality: 'many' }),
        rel('StoreProfile', 'StoreKey', 'Store', 'StoreKey', { fromCardinality: 'one', toCardinality: 'one', crossFilteringBehavior: 'bothDirections' }),
      ],
      roles: [
        { name: 'Retail', modelPermission: 'read', tablePermissions: [{ name: 'Customer', filterExpression: 'Customer[Segment] = "Retail"' }] },
        { name: 'Europe', modelPermission: 'read', tablePermissions: [{ name: 'Region', filterExpression: 'Region[Region] = "Europe"' }] },
      ],
    },
  };
}

// The model's own checks, before Power BI makes them: relationship columns' types match, a
// to-side column is unique unless the relationship is many-to-many, a key column is unique.
function check(bim) {
  const typeOf = (t, c) => data[t]?.columns.find(([n]) => n === c)?.[1];
  const values = (t, c) => data[t].rows.map(r => r[data[t].columns.findIndex(([n]) => n === c)]);
  const unique = (t, c) => { const v = values(t, c).filter(x => x != null); return new Set(v).size === v.length; };
  for (const r of bim.model.relationships) {
    const a = typeOf(r.fromTable, r.fromColumn), b = typeOf(r.toTable, r.toColumn);
    if (!a || a !== b) throw new Error(`${r.name}: ${a} -> ${b}`);
    if (r.toCardinality !== 'many' && !unique(r.toTable, r.toColumn)) throw new Error(`${r.name}: ${r.toTable}[${r.toColumn}] not unique`);
    if (r.fromCardinality === 'one' && !unique(r.fromTable, r.fromColumn)) throw new Error(`${r.name}: ${r.fromTable}[${r.fromColumn}] not unique`);
  }
  for (const [t, cols] of Object.entries(COLUMN_EXTRA)) for (const [c, x] of Object.entries(cols)) {
    if (x.isKey && (!unique(t, c) || values(t, c).includes(null))) throw new Error(`${t}[${c}] is a key with duplicates or blanks`);
  }
  const names = new Set(bim.model.tables.flatMap(t => t.columns.map(c => c.name.toLowerCase())));
  for (const [, n] of MEASURES) if (names.has(n.toLowerCase())) throw new Error(`measure ${n} has a column's name`);
}

const bim = build(name => ({ name, source: { type: 'entity', entityName: name } }));
check(bim);

const out = new URL('../../models/edges/', import.meta.url);
rmSync(new URL('data/', out), { recursive: true, force: true });
mkdirSync(new URL('data/', out), { recursive: true });
writeFileSync(new URL('model.bim', out), `${JSON.stringify(bim, null, 2)}\n`);
for (const [name, t] of Object.entries(data)) writeFileSync(new URL(`data/${name}.csv`, out), csv(t.columns, t.rows));
console.log(`models/edges: ${bim.model.tables.length} tables, ${Object.values(data).reduce((n, t) => n + t.rows.length, 0)} rows`);
