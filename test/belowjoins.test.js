// A fact table's sums and counts by columns of the tables it reaches over many-to-one relationships:
// the answer is a GROUP BY over the joins' rows; a sale whose customer isn't in Customer counts in
// the blank group, Power BI's blank row.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness, sorted } from './helpers.js';
import { bim, setup } from './fixtures/contoso.js';

let h;
before(async () => { h = await harness(bim, setup); });

test("by a column of a table one join away: grouped by the key first, the blank group too", async () => {
  const q = `EVALUATE SUMMARIZECOLUMNS(Customer[City], "s", [Sales Amount], "q", [Quantity], "o", [Orders])`;
  h.dax.compile(q);
  const got = sorted(await h.run(q));
  // The blank row: customer 99, with sales and no row in Customer, is in the blank group.
  const want = sorted(await h.sql(`SELECT c."City" AS "City", SUM(s."Amount") AS s, SUM(s."Qty") AS q, COUNT(*) AS o
    FROM "Sales" s LEFT JOIN "Customer" c ON c."CustomerKey" = s."CustomerKey" GROUP BY 1`));
  assert.deepEqual(got.map(Object.values), want.map(Object.values));
  assert.ok(got.some(r => r[Object.keys(r)[0]] == null), "the blank group");
});

test("by a column two joins away (Sales > Product > Category), and a min and a max", async () => {
  const q = `EVALUATE SUMMARIZECOLUMNS(Category[Category], "s", [Sales Amount], "lo", MIN(Sales[Qty]), "hi", MAX(Sales[Qty]))`;
  h.dax.compile(q);
  const got = sorted(await h.run(q));
  const want = sorted(await h.sql(`SELECT k."Category", SUM(s."Amount"), MIN(s."Qty"), MAX(s."Qty")
    FROM "Sales" s LEFT JOIN "Product" p ON p."ProductKey" = s."ProductKey" LEFT JOIN "Category" k ON k."CategoryKey" = p."CategoryKey" GROUP BY 1`));
  assert.deepEqual(got.map(Object.values), want.map(Object.values));
});

test("a distinct count is not added up from groups: written as it was", async () => {
  const q = `EVALUATE SUMMARIZECOLUMNS(Product[Color], "c", [Customers])`;
  h.dax.compile(q);
  const got = sorted(await h.run(q));
  const want = sorted(await h.sql(`SELECT p."Color", COUNT(DISTINCT s."CustomerKey")
    FROM "Sales" s LEFT JOIN "Product" p ON p."ProductKey" = s."ProductKey" GROUP BY 1`));
  assert.deepEqual(got.map(Object.values), want.map(Object.values));
});

test("last year's and the year to date's sales by month: each a GROUP BY over a mapping of (month, date)", async () => {
  const q = `EVALUATE SUMMARIZECOLUMNS('Date'[Year], 'Date'[Month], "ly", CALCULATE([Sales Amount], SAMEPERIODLASTYEAR('Date'[Date])), "ytd", TOTALYTD([Sales Amount], 'Date'[Date]))`;
  h.dax.compile(q);
  const got = sorted(await h.run(q));
  const want = sorted(await h.sql(`SELECT d."Year", d."Month",
      (SELECT SUM(s."Amount") FROM "Sales" s JOIN "Date" x ON x."Date" = s."OrderDate" WHERE x."Year" = d."Year" - 1 AND x."Month" = d."Month") AS ly,
      (SELECT SUM(s."Amount") FROM "Sales" s JOIN "Date" x ON x."Date" = s."OrderDate" WHERE x."Year" = d."Year" AND x."Month" <= d."Month") AS ytd
    FROM (SELECT DISTINCT "Year", "Month" FROM "Date") d WHERE ly IS NOT NULL OR ytd IS NOT NULL`));
  assert.deepEqual(got.map(Object.values), want.map(Object.values));
});

test("a count of no rows stays blank, and a row with none is left out", async () => {
  const q = `EVALUATE ADDCOLUMNS(VALUES(Product[Color]), "n", CALCULATE(COUNTROWS(Sales), Sales[Qty] > 1000))`;
  for (const r of await h.run(q)) assert.equal(r.n, null);
});

test("SUMMARIZE's extension columns: the group's rows are conditions on the scan, not Sales joined to itself", async () => {
  const q = `EVALUATE SUMMARIZE(Sales, 'Date'[Year], Product[Color], "s", [Sales Amount], "all", CALCULATE([Sales Amount], REMOVEFILTERS('Date')))`;
  h.dax.compile(q);
  const got = sorted(await h.run(q));
  const want = sorted(await h.sql(`SELECT d."Year", p."Color", SUM(s."Amount"), SUM(s."Amount")
    FROM "Sales" s LEFT JOIN "Date" d ON d."Date" = s."OrderDate" LEFT JOIN "Product" p ON p."ProductKey" = s."ProductKey" GROUP BY 1, 2`));
  assert.deepEqual(got.map(Object.values), want.map(Object.values));
});

test("a condition on a dimension one join away is the grouped scan's too, as its key IN the rows it keeps", async () => {
  const q = `SELECT "Product"."Color" AS c, AGG("Sales Amount") AS s FROM model WHERE "Customer"."City" IN ('Paris', 'Berlin') GROUP BY ALL`;
  h.dax.compile(q);
  const got = sorted(await h.run(q));
  const want = sorted(await h.sql(`SELECT p."Color" AS c, SUM(s."Amount") AS s FROM "Sales" s
    LEFT JOIN "Product" p ON p."ProductKey" = s."ProductKey" LEFT JOIN "Customer" c ON c."CustomerKey" = s."CustomerKey"
    WHERE c."City" IN ('Paris', 'Berlin') GROUP BY 1`));
  assert.deepEqual(got.map(Object.values), want.map(Object.values));
});

test("a condition a blank passes stays outside the scan: the sale to a customer not in Customer is still in it", async () => {
  const q = `SELECT "Product"."Color" AS c, AGG("Sales Amount") AS s FROM model WHERE "Customer"."City" IS NULL GROUP BY ALL`;
  h.dax.compile(q);
  const got = sorted(await h.run(q));
  const want = sorted(await h.sql(`SELECT p."Color" AS c, SUM(s."Amount") AS s FROM "Sales" s
    LEFT JOIN "Product" p ON p."ProductKey" = s."ProductKey" LEFT JOIN "Customer" c ON c."CustomerKey" = s."CustomerKey"
    WHERE c."City" IS NULL GROUP BY 1`));
  assert.ok(want.length > 0, "customer 99's sale");
  assert.deepEqual(got.map(Object.values), want.map(Object.values));
});
