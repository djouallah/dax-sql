// The blank row of a table that its many side filters back (CROSSFILTER BOTH): the many side's
// rows that have a key the table lacks belong to the blank row, so VALUES lists it when the
// filter keeps such a row; COUNTROWS of the table and DISTINCTCOUNT, which count the table's
// rows, do not. On the model of fixtures/contoso.js, every expected result worked out by hand
// from its sales.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness, sorted } from './helpers.js';
import { bim, setup } from './fixtures/contoso.js';

let h;
before(async () => { h = await harness(bim, setup); });

const both = 'CROSSFILTER(Sales[CustomerKey], Customer[CustomerKey], BOTH)';

test('a filter coming back from the many side reaches the blank row when its rows have a key the table lacks', async () => {
  // The Cap's sales: customers 3 and 1, and 99, whom Customer lacks (the blank row). The
  // Helmet has no sale: no customer, and no blank row.
  const rows = await h.run(`EVALUATE SUMMARIZECOLUMNS(Product[Name],
    "rows", CALCULATE(COUNTROWS(Customer), ${both}),
    "keys", CALCULATE(COUNTROWS(VALUES(Customer[CustomerKey])), ${both}),
    "names", CALCULATE(DISTINCTCOUNT(Customer[Customer]), ${both}),
    "list", CALCULATE(CONCATENATEX(VALUES(Customer[Customer]), Customer[Customer], ",", Customer[Customer], ASC), ${both}))`);
  assert.deepEqual(sorted(rows), sorted([
    { Name: 'Road Bike', rows: 3, keys: 3, names: 3, list: 'Alice,Bob,Chloe' },
    { Name: 'Mountain Bike', rows: 2, keys: 2, names: 2, list: 'Alice,Bob' },
    { Name: 'Jersey', rows: 3, keys: 3, names: 3, list: 'Alice,Bob,Chloe' },
    { Name: 'Cap', rows: 2, keys: 3, names: 2, list: ',Alice,Chloe' },
  ]));
});
