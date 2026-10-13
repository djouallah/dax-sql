// Text compared without regard to case (=, <, IN, TREATAS, LOOKUPVALUE), SUBSTITUTE with an
// instance number, and PERCENTILE.EXC; on the model of fixtures/contoso.js, every expected
// result worked out by hand from its 5 products.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness, sorted } from './helpers.js';
import { bim, setup } from './fixtures/contoso.js';

let h;
before(async () => { h = await harness(bim, setup); });

const eq = async (dax, expected) => assert.deepEqual(sorted(await h.run(dax)), sorted(expected));

test('text compares without regard to case: =, IN, TREATAS, LOOKUPVALUE, <', async () => {
  // Product colors: Red (2), Black (2), Blue (1).
  await eq(`EVALUATE SUMMARIZECOLUMNS(Product[Color],
    FILTER(ALL(Product[Color]), Product[Color] = "red" || Product[Color] IN { "BLUE" }), "n", COUNTROWS(Product))`,
  [{ Color: 'Red', n: 2 }, { Color: 'Blue', n: 1 }]);
  await eq(`EVALUATE ROW(
    "pred", CALCULATE(COUNTROWS(Product), Product[Color] = "RED"),
    "treatas", CALCULATE(COUNTROWS(Product), TREATAS({ "black", "BLUE" }, Product[Color])),
    "one", CALCULATE(COUNTROWS(Product), TREATAS({ "bLaCk" }, Product[Color])),
    "lookup", LOOKUPVALUE(Product[Name], Product[Color], "blue"),
    "strict", COUNTROWS(FILTER(Product, Product[Color] == "red")),
    "lt", "apple" < "BANANA")`,
  [{ pred: 2, treatas: 3, one: 2, lookup: 'Cap', strict: 2, lt: true }]);
});

test('SUBSTITUTE with an instance number replaces only that occurrence', () => eq(
  `EVALUATE ROW("second", SUBSTITUTE("a-b-c", "-", "+", 2), "none", SUBSTITUTE("a-b-c", "-", "+", 3),
    "longer", SUBSTITUTE("x--y--z", "--", "=", 2), "every", SUBSTITUTE("a-b-c", "-", "+"))`,
  [{ second: 'a-b+c', none: 'a-b-c', longer: 'x--y=z', every: 'a+b+c' }]));

test('PERCENTILE.EXC: the value at rank k(n + 1), interpolated', () => eq(
  // Prices in order: 20, 50, 60, 800, 1000. Ranks 3, 1.5 and 4.5.
  `EVALUATE ROW("p50", PERCENTILE.EXC(Product[Price], 0.5), "p25", PERCENTILE.EXC(Product[Price], 0.25),
    "p75", PERCENTILE.EXC(Product[Price], 0.75), "x25", PERCENTILEX.EXC(Product, Product[Price] * 2, 0.25))`,
  [{ p50: 60, p25: 35, p75: 900, x25: 70 }]));
