// Builds models/contoso: the small sales model dax-sql's tests run on (its test/fixtures/contoso.js),
// as model.bim and data/<Table>.csv, so the queries those tests ask are answered by Power BI.
//
//   Sales (11 rows) -> Product -> Category, Sales -> Customer, Sales -> Date by OrderDate (active)
//   and by ShipDate (inactive); Returns -> Product, Returns -> Date. Sale 11 is to customer 99,
//   who is not in Customer. CityTarget <-> Customer many-to-many on the city, Customer filtering it.
//   Calculated tables Big Products (Sales -> Big Products) and Days (CALENDARAUTO), calculation
//   groups Time Calc (10) and Scale (20), a field parameter (Fields), roles Paris, RedOnly and
//   Me (USERPRINCIPALNAME()), and a disconnected parent-child table, Staff.
//
// Folded in from tests that extend the fixture: the Sales -> Big Products relationship, Time
// Calc's Tenfold item, Customer's calculated columns Flag and Total Sales, and Staff.
// Adapted for Power BI: Big Products selects its three columns (a FILTER of Product would have
// all of Product's), and the model sets culture, discourageImplicitMeasures (which calculation
// groups need) and the Power BI data source version, as models/patterns does.
//
//   node tools/contoso/build.mjs
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { csv } from '../csv.mjs';

const col = (name, dataType, extra = {}) => ({ name, dataType, sourceColumn: name, ...extra });
const table = (name, columns, measures = [], extra = {}) => ({
  name, ...extra, columns, measures: measures.map(([n, e]) => ({ name: n, expression: e })),
  partitions: [{ name, source: { type: 'entity', entityName: name } }],
});
const calcTable = (name, expression, cols) => ({
  name,
  columns: cols.map(([n, dataType, sourceColumn, extra]) => ({ name: n, dataType, type: 'calculatedTableColumn', sourceColumn, ...extra })),
  partitions: [{ name, source: { type: 'calculated', expression } }],
});
const calcGroup = (name, precedence, items) => ({
  name,
  calculationGroup: { precedence, calculationItems: items.map(([n, expression], ordinal) => ({ name: n, expression, ordinal })) },
  columns: [{ name, dataType: 'string', sourceColumn: 'Name', sortByColumn: 'Ordinal' }, { name: 'Ordinal', dataType: 'int64', sourceColumn: 'Ordinal' }],
  partitions: [{ name: `${name} Partition`, source: { type: 'calculationGroup' } }],
});

const bim = {
  name: 'contoso',
  compatibilityLevel: 1604,
  model: {
    culture: 'en-US',
    discourageImplicitMeasures: true,
    defaultPowerBIDataSourceVersion: 'powerBI_V3',
    tables: [
      table('Category', [col('CategoryKey', 'int64', { isKey: true }), col('Category', 'string')]),
      table('Product', [
        col('ProductKey', 'int64', { isKey: true }), col('Name', 'string'), col('Color', 'string'),
        col('CategoryKey', 'int64'), col('Price', 'double'),
        { name: 'PriceBand', dataType: 'string', type: 'calculated', expression: 'IF(Product[Price] >= 100, "High", "Low")' },
      ], [
        ['Avg Price', 'AVERAGE(Product[Price])'],
        ['Product Count', 'COUNTROWS(Product)'],
      ]),
      table('Customer', [
        col('CustomerKey', 'int64', { isKey: true }), col('Customer', 'string'), col('City', 'string'),
        { name: 'Flag', dataType: 'int64', type: 'calculated', expression: '1' },
        { name: 'Total Sales', dataType: 'double', type: 'calculated', expression: 'CALCULATE(SUM(Sales[Amount]))' },
      ]),
      table('Date', [col('Date', 'dateTime', { isKey: true }), col('Year', 'int64'), col('Month', 'int64'), col('Quarter', 'int64')],
        [], { dataCategory: 'Time' }),
      table('Sales', [
        col('OrderDate', 'dateTime'), col('ShipDate', 'dateTime'), col('ProductKey', 'int64'), col('CustomerKey', 'int64'),
        col('Qty', 'int64'), col('Amount', 'decimal'),
        { name: 'LineValue', dataType: 'double', type: 'calculated', expression: 'Sales[Qty] * RELATED(Product[Price])' },
      ], [
        ['Sales Amount', 'SUM(Sales[Amount])'],
        ['Quantity', 'SUM(Sales[Qty])'],
        ['Orders', 'COUNTROWS(Sales)'],
        ['Customers', 'DISTINCTCOUNT(Sales[CustomerKey])'],
        ['All Sales', 'CALCULATE([Sales Amount], ALL(Sales))'],
        ['Red Sales', 'CALCULATE([Sales Amount], Product[Color] = "Red")'],
        ['Red Sales Kept', 'CALCULATE([Sales Amount], KEEPFILTERS(Product[Color] = "Red"))'],
        ['Share of Category', 'DIVIDE([Sales Amount], CALCULATE([Sales Amount], ALLEXCEPT(Product, Category[Category])))'],
        ['Sales by Ship Date', "CALCULATE([Sales Amount], USERELATIONSHIP(Sales[ShipDate], 'Date'[Date]))"],
        ['Sales YTD', "TOTALYTD([Sales Amount], 'Date'[Date])"],
        ['Sales PY', "CALCULATE([Sales Amount], SAMEPERIODLASTYEAR('Date'[Date]))"],
        ['Big Orders', 'CALCULATE([Orders], FILTER(Sales, Sales[Amount] > 100))'],
        ['Best Customer Sales', 'MAXX(VALUES(Customer[Customer]), [Sales Amount])'],
        ['Products Sold', 'COUNTROWS(FILTER(Product, [Sales Amount] > 0))'],
        ['Line Value', 'SUMX(Sales, Sales[Qty] * RELATED(Product[Price]))'],
        ['Line Value Column', 'SUM(Sales[LineValue])'],
        ['Return Rate', 'DIVIDE([Returned], [Quantity])'],
      ]),
      table('Returns', [col('Date', 'dateTime'), col('ProductKey', 'int64'), col('ReturnQty', 'int64')],
        [['Returned', 'SUM(Returns[ReturnQty])']]),
      table('CityTarget', [col('City', 'string'), col('Target', 'int64')], [['Target Total', 'SUM(CityTarget[Target])']]),
      table('Staff', [col('StaffKey', 'int64', { isKey: true }), col('Name', 'string'), col('ManagerKey', 'int64')]),
      calcTable('Big Products',
        'SELECTCOLUMNS(FILTER(Product, Product[Price] >= 100), "ProductKey", Product[ProductKey], "Name", Product[Name], "Price", Product[Price])', [
          ['ProductKey', 'int64', '[ProductKey]'], ['Name', 'string', '[Name]'], ['Price', 'double', '[Price]']]),
      calcTable('Days', 'CALENDARAUTO()', [['Date', 'dateTime', '[Date]']]),
      calcGroup('Time Calc', 10, [
        ['Current', 'SELECTEDMEASURE()'],
        ['YTD', "CALCULATE(SELECTEDMEASURE(), DATESYTD('Date'[Date]))"],
        ['PY', "CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR('Date'[Date]))"],
        ['YOY', 'SELECTEDMEASURE() - CALCULATE(SELECTEDMEASURE(), \'Time Calc\'[Time Calc] = "PY")'],
        ['Name', 'SELECTEDMEASURENAME()'],
        ['Tenfold', '[Sales Amount] * 10'],
      ]),
      calcGroup('Scale', 20, [['x2', 'SELECTEDMEASURE() * 2'], ['plus1', 'SELECTEDMEASURE() + 1']]),
      calcTable('Fields', "{ (\"Sales\", NAMEOF('Sales'[Sales Amount]), 0), (\"Quantity\", NAMEOF('Sales'[Quantity]), 1), (\"Color\", NAMEOF('Product'[Color]), 2) }", [
        ['Fields', 'string', '[Value1]'],
        ['Fields Fields', 'string', '[Value2]', { extendedProperties: [{ type: 'json', name: 'ParameterMetadata', value: { version: 3, kind: 2 } }] }],
        ['Fields Order', 'int64', '[Value3]']]),
    ],
    relationships: [
      { name: 'sales_product', fromTable: 'Sales', fromColumn: 'ProductKey', toTable: 'Product', toColumn: 'ProductKey' },
      { name: 'product_category', fromTable: 'Product', fromColumn: 'CategoryKey', toTable: 'Category', toColumn: 'CategoryKey' },
      { name: 'sales_customer', fromTable: 'Sales', fromColumn: 'CustomerKey', toTable: 'Customer', toColumn: 'CustomerKey' },
      { name: 'sales_orderdate', fromTable: 'Sales', fromColumn: 'OrderDate', toTable: 'Date', toColumn: 'Date' },
      { name: 'sales_shipdate', fromTable: 'Sales', fromColumn: 'ShipDate', toTable: 'Date', toColumn: 'Date', isActive: false },
      { name: 'returns_product', fromTable: 'Returns', fromColumn: 'ProductKey', toTable: 'Product', toColumn: 'ProductKey' },
      { name: 'returns_date', fromTable: 'Returns', fromColumn: 'Date', toTable: 'Date', toColumn: 'Date' },
      { name: 'target_city', fromTable: 'CityTarget', fromColumn: 'City', toTable: 'Customer', toColumn: 'City',
        fromCardinality: 'many', toCardinality: 'many' },
      { name: 'sales_big', fromTable: 'Sales', fromColumn: 'ProductKey', toTable: 'Big Products', toColumn: 'ProductKey' },
    ],
    roles: [
      { name: 'Paris', modelPermission: 'read', tablePermissions: [{ name: 'Customer', filterExpression: 'Customer[City] = "Paris"' }] },
      { name: 'RedOnly', modelPermission: 'read', tablePermissions: [{ name: 'Product', filterExpression: 'Product[Color] = "Red"' }] },
      { name: 'Me', modelPermission: 'read', tablePermissions: [{ name: 'Customer', filterExpression: 'Customer[Customer] = USERPRINCIPALNAME()' }] },
    ],
  },
};

// The rows, as the fixture's setup SQL makes them.
const dates = [];
for (let d = new Date(Date.UTC(2023, 0, 1)); d <= new Date(Date.UTC(2024, 11, 31)); d.setUTCDate(d.getUTCDate() + 1)) {
  const m = d.getUTCMonth() + 1;
  dates.push([d.toISOString().slice(0, 10), d.getUTCFullYear(), m, Math.ceil(m / 3)]);
}
const data = {
  Category: { columns: [['CategoryKey', 'int64'], ['Category', 'string']], rows: [[1, 'Bikes'], [2, 'Clothing'], [3, 'Accessories']] },
  Product: {
    columns: [['ProductKey', 'int64'], ['Name', 'string'], ['Color', 'string'], ['CategoryKey', 'int64'], ['Price', 'double']],
    rows: [[1, 'Road Bike', 'Red', 1, 1000], [2, 'Mountain Bike', 'Black', 1, 800], [3, 'Jersey', 'Red', 2, 50],
      [4, 'Cap', 'Blue', 2, 20], [5, 'Helmet', 'Black', 3, 60]],
  },
  Customer: {
    columns: [['CustomerKey', 'int64'], ['Customer', 'string'], ['City', 'string']],
    rows: [[1, 'Alice', 'Paris'], [2, 'Bob', 'London'], [3, 'Chloe', 'Paris'], [4, 'Dan', 'Berlin']],
  },
  Date: { columns: [['Date', 'dateTime'], ['Year', 'int64'], ['Month', 'int64'], ['Quarter', 'int64']], rows: dates },
  Sales: {
    columns: [['OrderDate', 'dateTime'], ['ShipDate', 'dateTime'], ['ProductKey', 'int64'], ['CustomerKey', 'int64'], ['Qty', 'int64'], ['Amount', 'decimal']],
    rows: [
      ['2023-01-15', '2023-01-20', 1, 1, 1, 1000], ['2023-02-10', '2023-02-12', 3, 1, 2, 100],
      ['2023-02-20', '2023-03-02', 2, 2, 1, 800], ['2023-06-05', '2023-06-07', 4, 3, 3, 60],
      ['2023-12-30', '2024-01-03', 3, 2, 1, 50], ['2024-01-10', '2024-01-12', 1, 3, 2, 2000],
      ['2024-02-14', '2024-02-16', 4, 1, 5, 100], ['2024-02-29', '2024-03-02', 3, 3, 4, 200],
      ['2024-03-15', '2024-03-18', 2, 1, 1, 800], ['2024-06-30', '2024-07-02', 1, 2, 1, 1000],
      ['2024-07-01', '2024-07-05', 4, 99, 1, 20],
    ],
  },
  Returns: {
    columns: [['Date', 'dateTime'], ['ProductKey', 'int64'], ['ReturnQty', 'int64']],
    rows: [['2023-02-15', 3, 1], ['2024-02-20', 4, 2], ['2024-03-20', 2, 1]],
  },
  CityTarget: { columns: [['City', 'string'], ['Target', 'int64']], rows: [['Paris', 5000], ['London', 2000], ['Rome', 1000]] },
  Staff: {
    columns: [['StaffKey', 'int64'], ['Name', 'string'], ['ManagerKey', 'int64']],
    rows: [[1, 'Ann', null], [2, 'Ben', 1], [3, 'Cy', 1], [4, 'Di', 2], [5, 'Ed', 4]],
  },
};

const out = new URL('../../models/contoso/', import.meta.url);
rmSync(new URL('data/', out), { recursive: true, force: true });
mkdirSync(new URL('data/', out), { recursive: true });
writeFileSync(new URL('model.bim', out), `${JSON.stringify(bim, null, 2)}\n`);
for (const [name, t] of Object.entries(data)) writeFileSync(new URL(`data/${name}.csv`, out), csv(t.columns, t.rows));
console.log(`models/contoso: ${bim.model.tables.length} tables, ${Object.values(data).reduce((n, t) => n + t.rows.length, 0)} rows`);
