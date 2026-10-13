// RANKX where a blank and zero meet, and ALLSELECTED of a column SUMMARIZECOLUMNS groups by;
// on the model of fixtures/contoso.js, every expected result worked out by hand from its 11 sales.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness, sorted } from './helpers.js';
import { bim, setup } from './fixtures/contoso.js';

let h;
before(async () => { h = await harness(bim, setup); });

const eq = async (dax, expected) => assert.deepEqual(sorted(await h.run(dax)), sorted(expected));
const r = (...names) => (...values) => Object.fromEntries(names.map((n, i) => [n, values[i]]));

test('RANKX ascending, DENSE: a blank and zero are one value', async () => {
  // Under 200 is zero: Helmet blank, Cap 0, Jersey 350, Mountain Bike 1600, Road Bike 4000.
  const row = r('Name', 'skip', 'dense');
  await eq(`DEFINE MEASURE Sales[Floored] = VAR s = [Sales Amount] RETURN IF(NOT ISBLANK(s) && s < 200, 0, s)
    EVALUATE ADDCOLUMNS(VALUES(Product[Name]),
      "skip", RANKX(ALL(Product[Name]), [Floored], , ASC, SKIP), "dense", RANKX(ALL(Product[Name]), [Floored], , ASC, DENSE))`,
  [row('Helmet', 1, 1), row('Cap', 1, 1), row('Jersey', 3, 2), row('Mountain Bike', 4, 3), row('Road Bike', 5, 4)]);
});

test('ALLSELECTED of a grouped column, as a table: the filters on that column, not on the others', async () => {
  const row = r('Name', 'n');
  // A filter on Color narrows the groups to the red products, not ALLSELECTED(Product[Name]).
  await eq(`EVALUATE SUMMARIZECOLUMNS(Product[Name], TREATAS({"Red"}, Product[Color]), "n", COUNTROWS(ALLSELECTED(Product[Name])))`,
    [row('Road Bike', 5), row('Jersey', 5)]);
  // A filter on Name itself does.
  await eq(`EVALUATE SUMMARIZECOLUMNS(Product[Name], TREATAS({"Red"}, Product[Color]), TREATAS({"Jersey", "Cap"}, Product[Name]),
    "n", COUNTROWS(ALLSELECTED(Product[Name])))`, [row('Jersey', 2)]);
});
