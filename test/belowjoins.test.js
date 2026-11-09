// A fact table's sums and counts by columns of the tables it reaches over many-to-one relationships:
// on DuckDB its rows are grouped by the keys before the joins (emit.js Fusion.belowJoins), and the
// answer is the same, the blank group included (a sale whose customer isn't in Customer).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness, sorted } from './helpers.js';
import { bim, setup } from './fixtures/contoso.js';

let h;
before(async () => { h = await harness(bim, setup); });

// The fused group's CTE: its scan of Sales grouped inside, then joined.
const groupedFirst = sql => /FROM "Sales" AS \w+ GROUP BY \w+\."(?:CustomerKey|ProductKey)"\) AS p\d+ LEFT JOIN/.test(sql);

test("by a column of a table one join away: grouped by the key first, the blank group kept", async () => {
  const q = `EVALUATE SUMMARIZECOLUMNS(Customer[City], "s", [Sales Amount], "q", [Quantity], "o", [Orders])`;
  const { sql } = h.dax.compile(q);
  assert.ok(groupedFirst(sql), sql);
  const got = sorted(await h.run(q));
  const want = sorted(await h.sql(`SELECT c."City" AS "City", SUM(s."Amount") AS s, SUM(s."Qty") AS q, COUNT(*) AS o
    FROM "Sales" s LEFT JOIN "Customer" c ON c."CustomerKey" = s."CustomerKey" GROUP BY 1`));
  assert.deepEqual(got.map(Object.values), want.map(Object.values));
  assert.ok(got.some(r => r[Object.keys(r)[0]] == null), "customer 99 is in the blank group");
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
