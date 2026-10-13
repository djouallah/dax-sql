// SUMMARIZE with ROLLUP, TOPNSKIP, the natural joins, SUBSTITUTEWITHINDEX and ADDMISSINGITEMS;
// on the model of fixtures/contoso.js, every expected result worked out by hand from its 11
// sales (by product: Road Bike 4000, Mountain Bike 1600, Jersey 350, Cap 180, Helmet none).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness, sorted } from './helpers.js';
import { bim, setup } from './fixtures/contoso.js';

let h;
before(async () => { h = await harness(bim, setup); });

const eq = async (dax, expected) => assert.deepEqual(sorted(await h.run(dax)), sorted(expected));
const r = (...names) => (...values) => Object.fromEntries(names.map((n, i) => [n, values[i]]));

test('SUMMARIZE with ROLLUP: a subtotal per level, its rolled-up columns blank; ISSUBTOTAL', async () => {
  const row = r('Category', 'Name', 's', 'byName', 'byCategory');
  await eq(`EVALUATE SUMMARIZE(Sales, ROLLUP(Category[Category], Product[Name]), "s", [Sales Amount],
    "byName", ISSUBTOTAL(Product[Name]), "byCategory", ISSUBTOTAL(Category[Category]))`, [
    row('Bikes', 'Road Bike', 4000, false, false), row('Bikes', 'Mountain Bike', 1600, false, false),
    row('Clothing', 'Jersey', 350, false, false), row('Clothing', 'Cap', 180, false, false),
    row('Bikes', null, 5600, true, false), row('Clothing', null, 530, true, false),
    row(null, null, 6130, true, true),
  ]);
});

test('TOPNSKIP: the rows after the first ones, in the order (descending unless it says)', async () => {
  const row = r('Name', 'Price');
  await eq('EVALUATE TOPNSKIP(2, 1, SELECTCOLUMNS(Product, "Name", Product[Name], "Price", Product[Price]), [Price])',
    [row('Mountain Bike', 800), row('Helmet', 60)]);
  await eq('EVALUATE TOPNSKIP(2, 1, SELECTCOLUMNS(Product, "Name", Product[Name], "Price", Product[Price]), [Price], ASC)',
    [row('Jersey', 50), row('Helmet', 60)]);
});

test('NATURALINNERJOIN, NATURALLEFTOUTERJOIN: by name for columns without lineage', async () => {
  const left = 'SELECTCOLUMNS(Category, "k", Category[CategoryKey] + 0, "Category", Category[Category])';
  const right = 'SELECTCOLUMNS(FILTER(Product, Product[Price] > 55), "k", Product[CategoryKey] + 0, "Name", Product[Name])';
  const row = r('k', 'Category', 'Name');
  await eq(`EVALUATE NATURALINNERJOIN(${left}, ${right})`,
    [row(1, 'Bikes', 'Road Bike'), row(1, 'Bikes', 'Mountain Bike'), row(3, 'Accessories', 'Helmet')]);
  await eq(`EVALUATE NATURALLEFTOUTERJOIN(${left}, ${right})`,
    [row(1, 'Bikes', 'Road Bike'), row(1, 'Bikes', 'Mountain Bike'), row(2, 'Clothing', null), row(3, 'Accessories', 'Helmet')]);
});

test("SUBSTITUTEWITHINDEX: the common columns replaced by the matching row's place, from 0", () => eq(
  `EVALUATE SUBSTITUTEWITHINDEX(SUMMARIZECOLUMNS(Category[Category], "s", [Sales Amount]), "i",
    VALUES(Category[Category]), Category[Category], ASC)`,
  [{ s: 5600, i: 1 }, { s: 530, i: 2 }]));

test('ADDMISSINGITEMS: the values the table lacks, with blank measures', () => eq(
  `EVALUATE ADDMISSINGITEMS(Product[Color],
    FILTER(SUMMARIZECOLUMNS(Product[Color], "s", [Sales Amount]), [s] > 1000), Product[Color])`,
  [{ Color: 'Red', s: 4350 }, { Color: 'Black', s: 1600 }, { Color: 'Blue', s: null }]));
