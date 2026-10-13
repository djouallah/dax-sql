// SUMMARIZECOLUMNS as a visual writes it: filters on one table (auto-exist), a matrix's two
// subtotal axes, and a calculation group grouped by its name and its ordinal. On the model of
// fixtures/contoso.js; every expected result worked out by hand from its 11 sales.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness, sorted } from './helpers.js';
import { bim, setup } from './fixtures/contoso.js';

let h;
before(async () => { h = await harness(bim, setup); });

const eq = async (dax, expected) => assert.deepEqual(sorted(await h.run(dax)), sorted(expected));
const r = (...names) => (...values) => Object.fromEntries(names.map((n, i) => [n, values[i]]));

test('auto-exist: filters on one table are the combinations it holds', async () => {
  // Black products in categories 1 and 2: the Mountain Bike (1600) only, so without the color
  // the category is 1 alone: the bikes, 4000 + 1600. Not 1 and 2, which adds clothing's 530.
  const filters = 'TREATAS({"Black"}, Product[Color]), TREATAS({1, 2}, Product[CategoryKey])';
  const nocolor = '"nocolor", CALCULATE([Sales Amount], REMOVEFILTERS(Product[Color]))';
  await eq(`EVALUATE SUMMARIZECOLUMNS(${filters}, "s", [Sales Amount], ${nocolor})`, [{ s: 1600, nocolor: 5600 }]);
  // The groups are the names those filters keep, the Mountain Bike, even where an expression
  // removes one of them: the Road Bike, red, is not a group.
  const row = r('Name', 's', 'nocolor');
  await eq(`EVALUATE SUMMARIZECOLUMNS(Product[Name], ${filters}, "s", [Sales Amount], ${nocolor})`, [row('Mountain Bike', 1600, 1600)]);
});

test('two ROLLUPADDISSUBTOTAL axes: every level of one with every level of the other', async () => {
  // 2023: bikes 1000 + 800, clothing 100 + 60 + 50; 2024: bikes 2000 + 800 + 1000, clothing
  // 100 + 200 + 20.
  const row = r('Category', 'Year', 'ct', 'yt', 's');
  await eq(`EVALUATE SUMMARIZECOLUMNS(ROLLUPADDISSUBTOTAL(Category[Category], "ct"), ROLLUPADDISSUBTOTAL('Date'[Year], "yt"), "s", [Sales Amount])`, [
    row('Bikes', 2023, false, false, 1800), row('Bikes', 2024, false, false, 3800),
    row('Clothing', 2023, false, false, 210), row('Clothing', 2024, false, false, 320),
    row('Bikes', null, false, true, 5600), row('Clothing', null, false, true, 530),
    row(null, 2023, true, false, 2010), row(null, 2024, true, false, 4120),
    row(null, null, true, true, 6130)]);
});

test("a calculation item selected by name applies on a row of another item's ordinal", async () => {
  // Grouped by the name and the ordinal, YOY's 'Time Calc'[Time Calc] = "PY" selects PY
  // though the row's ordinal is YOY's: 2024's 4120 less 2023's 2010.
  const row = r('Time Calc', 'Ordinal', 's');
  await eq(`EVALUATE SUMMARIZECOLUMNS('Time Calc'[Time Calc], 'Time Calc'[Ordinal], TREATAS({2024}, 'Date'[Year]),
    KEEPFILTERS(TREATAS({"Current", "PY", "YOY"}, 'Time Calc'[Time Calc])), "s", [Sales Amount])`,
  [row('Current', 0, 4120), row('PY', 2, 2010), row('YOY', 3, 2110)]);
});
