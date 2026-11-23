// A fact table's sums and counts by columns of the tables it reaches over many-to-one relationships:
// on DuckDB its rows are grouped by the keys before the joins (emit.js Fusion.belowJoins), and the
// answer is the same; a sale whose customer isn't in Customer counts in the total, in no group.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness, sorted } from './helpers.js';
import { bim, setup } from './fixtures/contoso.js';

let h;
before(async () => { h = await harness(bim, setup, { viaPlan: false }); });

// The fused group's CTE: its scan of Sales grouped inside, then joined.
const groupedFirst = sql => /FROM "Sales" AS \w+ GROUP BY \w+\."(?:CustomerKey|ProductKey)"\) AS p\d+ LEFT JOIN/.test(sql);

test("by a column of a table one join away: grouped by the key first, no blank group", async () => {
  const q = `EVALUATE SUMMARIZECOLUMNS(Customer[City], "s", [Sales Amount], "q", [Quantity], "o", [Orders])`;
  const { sql } = h.dax.compile(q);
  assert.ok(groupedFirst(sql), sql);
  const got = sorted(await h.run(q));
  // No blank row (by design): customer 99, with sales and no row in Customer, is in no group.
  const want = sorted(await h.sql(`SELECT c."City" AS "City", SUM(s."Amount") AS s, SUM(s."Qty") AS q, COUNT(*) AS o
    FROM "Sales" s JOIN "Customer" c ON c."CustomerKey" = s."CustomerKey" GROUP BY 1`));
  assert.deepEqual(got.map(Object.values), want.map(Object.values));
  assert.ok(!got.some(r => r[Object.keys(r)[0]] == null), "no blank group");
});

test("by a column two joins away (Sales > Product > Category), and a min and a max", async () => {
  const q = `EVALUATE SUMMARIZECOLUMNS(Category[Category], "s", [Sales Amount], "lo", MIN(Sales[Qty]), "hi", MAX(Sales[Qty]))`;
  const { sql } = h.dax.compile(q);
  assert.ok(groupedFirst(sql), sql);
  const got = sorted(await h.run(q));
  const want = sorted(await h.sql(`SELECT k."Category", SUM(s."Amount"), MIN(s."Qty"), MAX(s."Qty")
    FROM "Sales" s LEFT JOIN "Product" p ON p."ProductKey" = s."ProductKey" LEFT JOIN "Category" k ON k."CategoryKey" = p."CategoryKey" GROUP BY 1`));
  assert.deepEqual(got.map(Object.values), want.map(Object.values));
});

test("a distinct count is not added up from groups: written as it was", async () => {
  const q = `EVALUATE SUMMARIZECOLUMNS(Product[Color], "c", [Customers])`;
  const { sql } = h.dax.compile(q);
  assert.ok(!groupedFirst(sql), sql);
  const got = sorted(await h.run(q));
  const want = sorted(await h.sql(`SELECT p."Color", COUNT(DISTINCT s."CustomerKey")
    FROM "Sales" s LEFT JOIN "Product" p ON p."ProductKey" = s."ProductKey" GROUP BY 1`));
  assert.deepEqual(got.map(Object.values), want.map(Object.values));
});

// A time-intelligence filter that reads the group's keys is a mapping of (key, date) joined to the
// scan, which is grouped by the key: no subquery of each group.
const mappedJoins = sql => (sql.match(/JOIN m\d+ ON m\d+\.v = /g) ?? []).length;

test("last year's and the year to date's sales by month: each a GROUP BY over a mapping of (month, date)", async () => {
  const q = `EVALUATE SUMMARIZECOLUMNS('Date'[Year], 'Date'[Month], "ly", CALCULATE([Sales Amount], SAMEPERIODLASTYEAR('Date'[Date])), "ytd", TOTALYTD([Sales Amount], 'Date'[Date]))`;
  const { sql } = h.dax.compile(q);
  assert.equal(mappedJoins(sql), 2, sql);
  assert.doesNotMatch(sql, /\(SELECT SUM\([^()]*\) AS "v" FROM "Sales"/, sql);
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
  const { sql } = h.dax.compile(q);
  assert.doesNotMatch(sql, /EXISTS \(SELECT 1 FROM \(SELECT [^()]*"Qty"/, sql);
  const got = sorted(await h.run(q));
  const want = sorted(await h.sql(`SELECT d."Year", p."Color", SUM(s."Amount"), SUM(s."Amount")
    FROM "Sales" s LEFT JOIN "Date" d ON d."Date" = s."OrderDate" LEFT JOIN "Product" p ON p."ProductKey" = s."ProductKey" GROUP BY 1, 2`));
  assert.deepEqual(got.map(Object.values), want.map(Object.values));
});

// A dimension's condition (a Report's slicer: WHERE over the model) is the grouped scan's too, as its
// key IN the dimension's rows the condition keeps, so the engine skips the fact's rows no group keeps.
const keptInScan = sql => /FROM "Sales" AS \w+ WHERE [^()]*\w+\."CustomerKey" IN \(SELECT \w+\."CustomerKey" FROM "Customer" AS \w+ WHERE /.test(sql);

test("a condition on a dimension one join away is the grouped scan's too, as its key IN the rows it keeps", async () => {
  const q = `SELECT "Product"."Color" AS c, AGG("Sales Amount") AS s FROM model WHERE "Customer"."City" IN ('Paris', 'Berlin') GROUP BY ALL`;
  const { sql } = h.dax.compile(q);
  assert.ok(/\) AS p\d+ LEFT JOIN/.test(sql) && keptInScan(sql), sql);
  const got = sorted(await h.run(q));
  const want = sorted(await h.sql(`SELECT p."Color" AS c, SUM(s."Amount") AS s FROM "Sales" s
    LEFT JOIN "Product" p ON p."ProductKey" = s."ProductKey" LEFT JOIN "Customer" c ON c."CustomerKey" = s."CustomerKey"
    WHERE c."City" IN ('Paris', 'Berlin') GROUP BY 1`));
  assert.deepEqual(got.map(Object.values), want.map(Object.values));
});

test("a condition a blank passes stays outside the scan: the sale to a customer not in Customer is still in it", async () => {
  const q = `SELECT "Product"."Color" AS c, AGG("Sales Amount") AS s FROM model WHERE "Customer"."City" IS NULL GROUP BY ALL`;
  const { sql } = h.dax.compile(q);
  assert.ok(!keptInScan(sql), sql);
  const got = sorted(await h.run(q));
  const want = sorted(await h.sql(`SELECT p."Color" AS c, SUM(s."Amount") AS s FROM "Sales" s
    LEFT JOIN "Product" p ON p."ProductKey" = s."ProductKey" LEFT JOIN "Customer" c ON c."CustomerKey" = s."CustomerKey"
    WHERE c."City" IS NULL GROUP BY 1`));
  assert.ok(want.length > 0, "customer 99's sale");
  assert.deepEqual(got.map(Object.values), want.map(Object.values));
});
