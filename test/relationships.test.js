// Filters moving along relationships: a filter that comes back over a relationship that filters
// both ways, with row-level security and with the blank row; and a date table's date as a row
// context's value. On the model of fixtures/contoso.js, every expected result worked out by
// hand from its sales.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness, sorted } from './helpers.js';
import { bim, setup } from './fixtures/contoso.js';

let h;
before(async () => { h = await harness(bim, setup); });

const eqWith = async (hh, dax, expected) => assert.deepEqual(sorted(await hh.run(dax)), sorted(expected));

test('LASTNONBLANK over a table of dates; a date as a row value clears the rest of its date table', async () => {
  // The last day on or before 2024-03-10 with a sale: 2024-02-29. Each day is a filter on the
  // date table's date, which replaces the filter on its month: March has no sale before the 15th.
  await eqWith(h, `EVALUATE CALCULATETABLE(ROW("d", LASTNONBLANK(FILTER(ALL('Date'[Date]), 'Date'[Date] <= DATE(2024, 3, 10)),
    CALCULATE(COUNTROWS(Sales)))), 'Date'[Year] = 2024, 'Date'[Month] = 3)`, [{ d: '2024-02-29' }]);
  await eqWith(h, `EVALUATE ROW("d", FIRSTNONBLANK(FILTER(ALL('Date'[Date]), 'Date'[Date] >= DATE(2024, 3, 1)), CALCULATE(COUNTROWS(Sales))))`,
    [{ d: '2024-03-15' }]);
});

test('row-level security does not filter back over a relationship that filters both ways only for filters', async () => {
  // Returns -> Product both ways (security one way). Under RedOnly, Returns holds the red
  // products' returns (the Jersey's); Product is not filtered to the products returned: both
  // red products (Road Bike, Jersey) are there and both sold.
  const b = structuredClone(bim);
  b.model.relationships.find(r => r.name === 'returns_product').crossFilteringBehavior = 'bothDirections';
  const red = await harness(b, setup, { roles: 'RedOnly' });
  await eqWith(red, `EVALUATE ROW("p", CALCULATE(COUNTROWS(Product), Product[Color] = "Red"),
    "sold", COUNTROWS(FILTER(VALUES(Product[ProductKey]), NOT ISBLANK([Sales Amount]))))`, [{ p: 2, sold: 2 }]);
});

test('the blank row filters back over a relationship that filters both ways', async () => {
  // A sale of product 9, which Product lacks: Product's blank row, and so Category's. Both ways,
  // Product's blank row keeps Category's blank row alone, whose category is blank. The Helmet,
  // unsold, stays: its category is not blank.
  const h2 = await harness(bim, `${setup}
INSERT INTO "Sales" VALUES (DATE '2024-08-01', DATE '2024-08-02', 9, 1, 1, 7);`);
  await eqWith(h2, `EVALUATE SUMMARIZECOLUMNS(Product[Name], "s", [Sales Amount],
    "c", CALCULATE(SELECTEDVALUE(Category[Category], "none"), CROSSFILTER(Product[CategoryKey], Category[CategoryKey], BOTH)))`, [
    { Name: 'Road Bike', s: 4000, c: 'Bikes' }, { Name: 'Mountain Bike', s: 1600, c: 'Bikes' }, { Name: 'Jersey', s: 350, c: 'Clothing' },
    { Name: 'Cap', s: 180, c: 'Clothing' }, { Name: 'Helmet', s: null, c: 'Accessories' }, { Name: null, s: 7, c: null }]);
});
