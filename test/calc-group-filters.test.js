// A CALCULATE filter on a calculation group's name, grouped by the name and the ordinal: the
// filter replaces the name, not the ordinal, and the item applied follows the name. On the
// model of fixtures/contoso.js; every expected result worked out by hand from its 11 sales.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness, sorted } from './helpers.js';
import { bim, setup } from './fixtures/contoso.js';

let h;
before(async () => { h = await harness(bim, setup); });

const eq = async (dax, expected) => assert.deepEqual(sorted(await h.run(dax)), sorted(expected));
const r = (...names) => (...values) => Object.fromEntries(names.map((n, i) => [n, values[i]]));

test("a filter on a calculation group's name keeps the row's ordinal, and selects by the name", async () => {
  // On Current's row (ordinal 0), name "PY" leaves no row of the group's table: n is blank,
  // and only removing the ordinal too brings PY's row back. The item applied is PY on both
  // rows all the same: 2023's 2010.
  const row = r('Time Calc', 'Ordinal', 'n', 'nAll', 's');
  const py = `'Time Calc'[Time Calc] = "PY"`;
  await eq(`EVALUATE SUMMARIZECOLUMNS('Time Calc'[Time Calc], 'Time Calc'[Ordinal], TREATAS({2024}, 'Date'[Year]),
    KEEPFILTERS(TREATAS({"Current", "PY"}, 'Time Calc'[Time Calc])),
    "n", CALCULATE(COUNTROWS('Time Calc'), ${py}),
    "nAll", CALCULATE(COUNTROWS('Time Calc'), ${py}, REMOVEFILTERS('Time Calc'[Ordinal])),
    "s", CALCULATE([Sales Amount], ${py}))`,
  [row('Current', 0, null, 1, 2010), row('PY', 2, 1, 1, 2010)]);
});
