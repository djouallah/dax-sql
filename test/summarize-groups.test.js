// SUMMARIZE's expressions see their group as the group's rows of the table, not only its
// values; on the model of fixtures/contoso.js, every expected result worked out by hand from
// its 11 sales (by color: Red 4350, Black 1600, Blue 180; by year: 2023 2010, 2024 4120).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness, sorted } from './helpers.js';
import { bim, setup } from './fixtures/contoso.js';

let h;
before(async () => { h = await harness(bim, setup); });

const eq = async (dax, expected) => assert.deepEqual(sorted(await h.run(dax)), sorted(expected));
const r = (...names) => (...values) => Object.fromEntries(names.map((n, i) => [n, values[i]]));

test('SUMMARIZE: removing a grouping column\'s filter keeps the group\'s rows', async () => {
  const row = r('Color', 's', 'all');
  // The group's sales stay: ALL(Product[Color]) only takes the color off them.
  await eq(`EVALUATE SUMMARIZE(Sales, Product[Color], "s", [Sales Amount], "all", CALCULATE([Sales Amount], ALL(Product[Color])))`,
    [row('Red', 4350, 4350), row('Black', 1600, 1600), row('Blue', 180, 180)]);
  // ADDCOLUMNS over the groups has their values only: every color's sales.
  await eq(`EVALUATE ADDCOLUMNS(SUMMARIZE(Sales, Product[Color]), "s", [Sales Amount], "all", CALCULATE([Sales Amount], ALL(Product[Color])))`,
    [row('Red', 4350, 6130), row('Black', 1600, 6130), row('Blue', 180, 6130)]);
});

test('SUMMARIZE with ROLLUP: a filter replacing a grouping column\'s meets the group\'s rows', async () => {
  // 2024 in place of the year: the 2023 sales are not in it; the grand total has all sales.
  const row = r('Year', 'y2024');
  await eq(`EVALUATE SUMMARIZE(Sales, ROLLUP('Date'[Year]), "y2024", CALCULATE([Sales Amount], 'Date'[Year] = 2024))`,
    [row(2023, null), row(2024, 4120), row(null, 4120)]);
});
