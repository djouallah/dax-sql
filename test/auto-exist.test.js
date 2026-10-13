// SUMMARIZECOLUMNS' auto-exist with a grouping column of the filtered table: the group's key is
// part of the combinations its filters merge into. On the model of fixtures/contoso.js; the
// expected results worked out by hand from its 11 sales.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness, sorted } from './helpers.js';
import { bim, setup } from './fixtures/contoso.js';

let h;
before(async () => { h = await harness(bim, setup); });

test('auto-exist: removing one filter leaves the others to the values they have with the group', async () => {
  // Red or Blue, Road Bike or Cap: the Road Bike (High, Red) and the Cap (Low, Blue). Without
  // the name filter, the colors left are those of the group's own combinations: High is Red,
  // the Road Bike (1000 + 2000 + 1000); Low is Blue, the Cap (60 + 100 + 20), not the Red
  // Jersey (350) as well, which is Low and Red but not one of the combinations.
  const rows = await h.run(`EVALUATE SUMMARIZECOLUMNS(Product[PriceBand],
    TREATAS({"Red", "Blue"}, Product[Color]), TREATAS({"Road Bike", "Cap"}, Product[Name]),
    "s", [Sales Amount], "noname", CALCULATE([Sales Amount], REMOVEFILTERS(Product[Name])))`);
  assert.deepEqual(sorted(rows), sorted([
    { PriceBand: 'High', s: 4000, noname: 4000 },
    { PriceBand: 'Low', s: 180, noname: 180 },
  ]));
});
