// Fixed decimal numbers (currency) in arithmetic, on the small sales model of
// fixtures/contoso.js, whose Sales[Amount] is one: Red sells 4350, Black 1600, Blue 180.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness, sorted } from './helpers.js';
import { bim, setup } from './fixtures/contoso.js';

let h;
before(async () => { h = await harness(bim, setup); });

const eq = async (dax, expected) => assert.deepEqual(sorted(await h.run(dax)), sorted(expected));
const r = (...names) => (...values) => Object.fromEntries(names.map((n, i) => [n, values[i]]));

test('a fixed decimal divided or multiplied by a number is one: four places', async () => {
  // 4350/7 = 621.428571.., 1600/7 = 228.571428.., 180/7 = 25.714285..; 1/3 is a decimal
  // number, and 4350 * 0.333.. is 1449.99999.. before it is rounded.
  const row = r('Color', 'd', 'q', 'm', 'n');
  await eq(`EVALUATE SUMMARIZECOLUMNS(Product[Color], "d", DIVIDE([Sales Amount], 7), "q", [Sales Amount] / 7,
    "m", [Sales Amount] * (1 / 3), "n", 3 * [Sales Amount])`,
  [row('Red', 621.4286, 621.4286, 1450, 13050), row('Black', 228.5714, 228.5714, 533.3333, 4800), row('Blue', 25.7143, 25.7143, 60, 540)]);
});

test('an allocation sums the rounded shares', async () => {
  // Each color's sales times 2, over 22: 395.4545 + 145.4545 + 16.3636, where 6130 / 11 is
  // 557.2727 rounded.
  await eq('EVALUATE ROW("a", SUMX(VALUES(Product[Color]), DIVIDE(CALCULATE([Sales Amount]) * 2, 22)))', [{ a: 557.2726 }]);
});

test('two fixed decimals divided, or one plus a decimal number, are a decimal number', async () => {
  // 4350 / 6130 = 0.70962479..; 4350 + 1/3.
  await eq('EVALUATE ROW("s", DIVIDE([Red Sales], [Sales Amount]), "p", [Red Sales] + 1 / 3)', [{ s: 0.709624796, p: 4350.333333333 }]);
});
