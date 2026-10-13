// Builds models/patterns: the patterns model (model.bim) and its rows (data/<Table>.csv), from
// the seeded generator (data.js) and the measures (measures/<family>.js, a file per query
// family, so the families grow apart). A sales model in the manner of SQLBI's DAX Patterns:
//
//   Sales -> Product -> Subcategory -> Category      Budget -> Category, Budget <-> Date (YearMonth, many-to-many)
//   Sales -> Customer <-> AccountCustomer -> Account  (bridge; the bridge filters Customer both ways)
//   Sales -> Date by Order Date (active), by Delivery Date (inactive)
//   Sales -> Employee (parent-child)  Sales -> Currency <- ExchangeRate -> Date
//   Inventory -> Date, Product (month-end snapshots)   Segments (disconnected)
//
//   node tools/patterns/build.mjs
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { csv } from '../csv.mjs';
import { generate } from './data.js';
import base from './measures/base.js';
import segmentation from './measures/segmentation.js';
import customers from './measures/customers.js';
import time from './measures/time.js';
import relationships from './measures/relationships.js';
import context from './measures/context.js';
import queries from './measures/queries.js';
import gaps from './measures/gaps.js';

const data = generate();

const MEASURES = [...base, ...segmentation, ...customers, ...time, ...relationships, ...context, ...queries, ...gaps];

// Extra column properties, and the calculated columns, by table.
const COLUMN_EXTRA = {
  Date: { Date: { isKey: true }, 'Month Name': { sortByColumn: 'Month' }, 'Day Name': { sortByColumn: 'Weekday' } },
  Category: { CategoryKey: { isKey: true } },
  Subcategory: { SubcategoryKey: { isKey: true } },
  Product: { ProductKey: { isKey: true } },
  Customer: { CustomerKey: { isKey: true } },
  Employee: { EmployeeKey: { isKey: true } },
  Account: { AccountKey: { isKey: true } },
  Currency: { CurrencyCode: { isKey: true } },
  Segments: { Segment: { sortByColumn: 'Segment Order' } },
};
const CALCULATED = {
  Product: [
    ['Price Band', 'string', 'SWITCH(TRUE(), Product[Unit Price] >= 1000, "Premium", Product[Unit Price] >= 100, "Mid", "Budget")'],
    ['Category', 'string', 'RELATED(Category[Category])'],
  ],
  Sales: [
    ['Line Amount', 'double', 'Sales[Quantity] * Sales[Net Price]'],
  ],
  Customer: [
    ['First Order', 'dateTime', 'CALCULATE(MIN(Sales[Order Date]))'],
  ],
};
const TABLE_EXTRA = { Date: { dataCategory: 'Time' } };

const calcGroup = (name, precedence, items) => ({
  name,
  calculationGroup: { precedence, calculationItems: items.map(([n, expression], ordinal) => ({ name: n, expression, ordinal })) },
  columns: [{ name, dataType: 'string', sourceColumn: 'Name', sortByColumn: 'Ordinal' }, { name: 'Ordinal', dataType: 'int64', sourceColumn: 'Ordinal' }],
  partitions: [{ name: `${name} Partition`, source: { type: 'calculationGroup' } }],
});

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
  tables.push(calcGroup('Time Intelligence', 10, [
    ['Current', 'SELECTEDMEASURE()'],
    ['PY', "CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR('Date'[Date]))"],
    ['YoY', "VAR cur = SELECTEDMEASURE() VAR py = CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR('Date'[Date])) RETURN IF(NOT ISBLANK(cur) && NOT ISBLANK(py), cur - py)"],
    ['YoY %', "DIVIDE(CALCULATE(SELECTEDMEASURE(), 'Time Intelligence'[Time Intelligence] = \"YoY\"), CALCULATE(SELECTEDMEASURE(), 'Time Intelligence'[Time Intelligence] = \"PY\"))"],
    ['YTD', "CALCULATE(SELECTEDMEASURE(), DATESYTD('Date'[Date]))"],
    ['MAT', "CALCULATE(SELECTEDMEASURE(), DATESINPERIOD('Date'[Date], MAX('Date'[Date]), -1, YEAR))"],
  ]));
  tables.push({
    name: 'Metric',
    columns: [
      { name: 'Metric', dataType: 'string', type: 'calculatedTableColumn', sourceColumn: '[Value1]', sortByColumn: 'Metric Order' },
      { name: 'Metric Fields', dataType: 'string', type: 'calculatedTableColumn', sourceColumn: '[Value2]',
        extendedProperties: [{ type: 'json', name: 'ParameterMetadata', value: { version: 3, kind: 2 } }] },
      { name: 'Metric Order', dataType: 'int64', type: 'calculatedTableColumn', sourceColumn: '[Value3]' },
    ],
    partitions: [{ name: 'Metric', source: { type: 'calculated', expression:
      "{ (\"Sales\", NAMEOF('Sales'[Sales Amount]), 0), (\"Margin\", NAMEOF('Sales'[Margin]), 1), (\"Quantity\", NAMEOF('Sales'[Total Quantity]), 2) }" } }],
  });
  return {
    name: 'dax-sql-patterns',
    compatibilityLevel: 1604,
    model: {
      culture: 'en-US',
      discourageImplicitMeasures: true,
      defaultPowerBIDataSourceVersion: 'powerBI_V3',
      tables,
      relationships: [
        rel('Sales', 'ProductKey', 'Product', 'ProductKey'),
        rel('Product', 'SubcategoryKey', 'Subcategory', 'SubcategoryKey'),
        rel('Subcategory', 'CategoryKey', 'Category', 'CategoryKey'),
        rel('Sales', 'CustomerKey', 'Customer', 'CustomerKey'),
        rel('Sales', 'Order Date', 'Date', 'Date'),
        rel('Sales', 'Delivery Date', 'Date', 'Date', { isActive: false }),
        rel('Sales', 'EmployeeKey', 'Employee', 'EmployeeKey'),
        rel('Sales', 'CurrencyCode', 'Currency', 'CurrencyCode'),
        rel('ExchangeRate', 'Date', 'Date', 'Date'),
        rel('ExchangeRate', 'CurrencyCode', 'Currency', 'CurrencyCode'),
        rel('Budget', 'CategoryKey', 'Category', 'CategoryKey'),
        rel('Budget', 'YearMonth', 'Date', 'YearMonth', { fromCardinality: 'many', toCardinality: 'many' }),
        rel('Inventory', 'Date', 'Date', 'Date'),
        rel('Inventory', 'ProductKey', 'Product', 'ProductKey'),
        rel('AccountCustomer', 'AccountKey', 'Account', 'AccountKey'),
        rel('AccountCustomer', 'CustomerKey', 'Customer', 'CustomerKey', { crossFilteringBehavior: 'bothDirections' }),
      ],
      roles: [
        { name: 'France', modelPermission: 'read', tablePermissions: [{ name: 'Customer', filterExpression: 'Customer[Country] = "France"' }] },
        { name: 'Bikes', modelPermission: 'read', tablePermissions: [{ name: 'Category', filterExpression: 'Category[Category] = "Bikes"' }] },
      ],
    },
  };
}

function rel(fromTable, fromColumn, toTable, toColumn, extra = {}) {
  const name = `${fromTable}_${fromColumn}_${toTable}`.replace(/\W+/g, '_');
  return { name, fromTable, fromColumn, toTable, toColumn, ...extra };
}

const bim = build(name => ({ name, source: { type: 'entity', entityName: name } }));

const out = new URL('../../models/patterns/', import.meta.url);
rmSync(new URL('data/', out), { recursive: true, force: true });
mkdirSync(new URL('data/', out), { recursive: true });
writeFileSync(new URL('model.bim', out), `${JSON.stringify(bim, null, 2)}\n`);
for (const [name, t] of Object.entries(data)) writeFileSync(new URL(`data/${name}.csv`, out), csv(t.columns, t.rows));
console.log(`models/patterns: ${bim.model.tables.length} tables, ${Object.values(data).reduce((n, t) => n + t.rows.length, 0)} rows`);
