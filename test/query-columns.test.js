// DEFINE COLUMN (a calculated column for one query) and NONVISUAL filters of
// SUMMARIZECOLUMNS, on the small sales model of fixtures/contoso.js.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness, sorted } from './helpers.js';
import { bim, setup } from './fixtures/contoso.js';

let h, red;
before(async () => {
  h = await harness(bim, setup);
  red = await harness(bim, setup, { roles: 'RedOnly' });
});

const region = `DEFINE COLUMN Customer[Region] = IF(Customer[City] = "Paris", "Paris", "Other")`;

test('DEFINE COLUMN: grouped by, filtered on, and cleared by ALL of its table', async () => {
  // Paris: Alice 2000 + Chloe 2260; Other: Bob 1850; the sale of customer 99 is the blank row's.
  assert.deepEqual(sorted(await h.run(`${region}
    EVALUATE SUMMARIZECOLUMNS(Customer[Region], "Sales", [Sales Amount], "All", CALCULATE([Sales Amount], ALL(Customer)))`)),
  [{ Region: null, Sales: 20, All: 6130 }, { Region: 'Other', Sales: 1850, All: 6130 }, { Region: 'Paris', Sales: 4260, All: 6130 }]);
  assert.deepEqual(await h.run(`${region}
    EVALUATE ROW("Other", CALCULATE([Sales Amount], Customer[Region] = "Other"))`), [{ Other: 1850 }]);
});

test('DEFINE COLUMN: a row context of its table, without security; gone after the query', async () => {
  const orders = `DEFINE COLUMN Customer[Orders] = COUNTROWS(RELATEDTABLE(Sales))`;
  // Alice has 4 sales, Bob and Chloe 3, Dan none.
  assert.deepEqual(await h.run(`${orders}
    EVALUATE ROW("n", CALCULATE(COUNTROWS(Customer), Customer[Orders] >= 3), "max", MAXX(Customer, Customer[Orders]))`),
  [{ n: 3, max: 4 }]);
  // Under a role that keeps the red products only, Alice has 2 sales; the column counts all 4.
  assert.deepEqual(await red.run(`${orders} EVALUATE ROW("max", MAXX(Customer, Customer[Orders]))`), [{ max: 4 }]);
  assert.throws(() => h.dax.compile(`EVALUATE ROW("n", MAX(Customer[Orders]))`), e => e.code === 'SEMANTIC');
});

test('NONVISUAL: the filter applies to the groups and values, not to what ALLSELECTED restores', async () => {
  // 2024's sales are 4120 of 6130.
  const q = f => `EVALUATE SUMMARIZECOLUMNS('Date'[Year], ${f}, "Sales", [Sales Amount],
    "Selected", CALCULATE([Sales Amount], ALLSELECTED('Date'[Year])))`;
  assert.deepEqual(await h.run(q(`NONVISUAL(TREATAS({2024}, 'Date'[Year]))`)), [{ Year: 2024, Sales: 4120, Selected: 6130 }]);
  assert.deepEqual(await h.run(q(`TREATAS({2024}, 'Date'[Year])`)), [{ Year: 2024, Sales: 4120, Selected: 4120 }]);
  assert.throws(() => h.dax.compile(`EVALUATE ROW("x", CALCULATE([Sales Amount], NONVISUAL(TREATAS({2024}, 'Date'[Year]))))`),
    e => e.code === 'SEMANTIC');
});
