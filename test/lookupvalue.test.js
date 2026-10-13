// LOOKUPVALUE searches its table without the filter context: a filter on the table, direct or
// from a related table, does not hide the row it finds. On the model of fixtures/contoso.js:
// the Cap is the one Blue product, priced 20.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness, sorted } from './helpers.js';
import { bim, setup } from './fixtures/contoso.js';

let h;
before(async () => { h = await harness(bim, setup); });

const eq = async (dax, expected) => assert.deepEqual(sorted(await h.run(dax)), sorted(expected));

test('LOOKUPVALUE ignores the filter context', () => eq(
  `EVALUATE SUMMARIZECOLUMNS(Product[Color],
    "cap", LOOKUPVALUE(Product[Price], Product[Name], "Cap"),
    "red", CALCULATE(LOOKUPVALUE(Product[Price], Product[Name], "Cap"), Product[Color] = "Red"))`,
  [{ Color: 'Red', cap: 20, red: 20 }, { Color: 'Black', cap: 20, red: 20 }, { Color: 'Blue', cap: 20, red: 20 }]));
