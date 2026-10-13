// Ranks and window functions where blanks and added columns decide the result; on the model of
// fixtures/contoso.js, every expected result worked out by hand from its 11 sales.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness, sorted } from './helpers.js';
import { bim, setup } from './fixtures/contoso.js';

let h;
before(async () => { h = await harness(bim, setup); });

const eq = async (dax, expected) => assert.deepEqual(sorted(await h.run(dax)), sorted(expected));
const r = (...names) => (...values) => Object.fromEntries(names.map((n, i) => [n, values[i]]));

test('RANKX ascending, DENSE: a blank is a value, ahead of every positive one', async () => {
  // Helmet has no sales; then Cap 180, Jersey 350, Mountain Bike 1600, Road Bike 4000.
  const row = r('Name', 'skip', 'dense');
  await eq(`EVALUATE ADDCOLUMNS(VALUES(Product[Name]),
    "skip", RANKX(ALL(Product[Name]), [Sales Amount], , ASC, SKIP), "dense", RANKX(ALL(Product[Name]), [Sales Amount], , ASC, DENSE))`,
  [row('Helmet', 1, 1), row('Cap', 2, 2), row('Jersey', 3, 3), row('Mountain Bike', 4, 4), row('Road Bike', 5, 5)]);
});

test('RANK over a table variable: the current row by the column ADDCOLUMNS added', async () => {
  const row = r('Name', '@s', 'r');
  await eq(`EVALUATE VAR t = ADDCOLUMNS(ALL(Product[Name]), "@s", [Sales Amount])
    RETURN ADDCOLUMNS(t, "r", RANK(DENSE, t, ORDERBY([@s], DESC), LAST))`,
  [row('Road Bike', 4000, 1), row('Mountain Bike', 1600, 2), row('Jersey', 350, 3), row('Cap', 180, 4), row('Helmet', null, 5)]);
});

test("INDEX with PARTITIONBY and no current row: every partition, the blank row's too", async () => {
  // The best product of each customer; sale 11's customer is not in Customer: its blank row.
  const row = r('Customer', 'Name', 's');
  await eq(`EVALUATE INDEX(1, SUMMARIZECOLUMNS(Customer[Customer], Product[Name], "s", [Sales Amount]),
    ORDERBY([s], DESC, Product[Name], ASC), PARTITIONBY(Customer[Customer]))`,
  [row('Alice', 'Road Bike', 1000), row('Bob', 'Road Bike', 1000), row('Chloe', 'Road Bike', 2000), row(null, 'Cap', 20)]);
});
