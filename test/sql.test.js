// SQL over the model: each SELECT answers what the DAX query it stands for answers, and its
// errors carry their codes.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness, sorted } from './helpers.js';
import { bim, setup } from './fixtures/contoso.js';
import { parseQuery } from '../src/parser.js';
import { SqlTranslator } from '../src/sql.js';

let h;
before(async () => { h = await harness(bim, setup); });

const PAIRS = [
  [`SELECT Product.Color, AGG(Orders), AGG(Sales.Quantity), AGG("Sales Amount") FROM model GROUP BY ALL`,
    `EVALUATE SUMMARIZECOLUMNS(Product[Color], "Orders", [Orders], "Quantity", [Quantity], "Sales Amount", [Sales Amount])`],
  // WHERE filters the measures and the groups; HAVING reads the SELECT's names.
  [`SELECT Color, AGG([Sales Amount]) AS s, MEASURE(Orders) o FROM contoso
    WHERE Customer.City = 'Paris' GROUP BY ALL HAVING s > 100`,
    `EVALUATE CALCULATETABLE(FILTER(SUMMARIZECOLUMNS(Product[Color], "s", [Sales Amount], "o", [Orders]), [s] > 100), Customer[City] = "Paris")`],
  // A condition on several tables; a HAVING on a measure the SELECT leaves out, and a group.
  [`SELECT Category.Category, AGG(Quantity) q FROM m
    WHERE Product.Name LIKE '%Bike' OR Customer.City IS NULL
    GROUP BY ALL HAVING AGG("Sales Amount") > 500 AND Category.Category <> 'Clothing'`,
    `EVALUATE CALCULATETABLE(FILTER(SUMMARIZECOLUMNS(Category[Category], "q", [Quantity]), [Sales Amount] > 500 && Category[Category] <> "Clothing"),
      FILTER(CROSSJOIN(ALL(Product[Name]), ALL(Customer[City])), RIGHT(Product[Name], 4) = "Bike" || ISBLANK(Customer[City])))`],
  // No GROUP BY: one row. Aggregates of columns.
  [`SELECT SUM(Sales.Amount) total, COUNT(DISTINCT Sales.CustomerKey) c, AGG(Orders) * 2 AS o2 FROM m
    WHERE Product.Price BETWEEN 50 AND 1000 AND 'Date'[Year] IN (2024)`,
    `EVALUATE CALCULATETABLE(ROW("total", SUM(Sales[Amount]), "c", DISTINCTCOUNTNOBLANK(Sales[CustomerKey]), "o2", [Orders] * 2),
      Product[Price] >= 50 && Product[Price] <= 1000, 'Date'[Year] IN {2024})`],
  // The SELECT's order and names; a group by position.
  [`SELECT AGG("Sales Amount") AS s, Category.Category AS cat FROM m
    WHERE Product.Color NOT IN ('Blue') GROUP BY 2`,
    `EVALUATE SELECTCOLUMNS(CALCULATETABLE(SUMMARIZECOLUMNS(Category[Category], "s", [Sales Amount]), NOT(Product[Color] IN {"Blue"})),
      "s", [s], "cat", Category[Category])`],
  // Subtotals: ROLLUP of a column and of a group, each flagged by its GROUPING.
  [`SELECT Category.Category, Product.Color, AGG("Sales Amount") AS s, GROUPING(Product.Color) AS sub FROM m
    GROUP BY Category.Category, ROLLUP(Product.Color)`,
    `EVALUATE SELECTCOLUMNS(SUMMARIZECOLUMNS(Category[Category], ROLLUPADDISSUBTOTAL(Product[Color], "sub"), "s", [Sales Amount]),
      "Category", Category[Category], "Color", Product[Color], "s", [s], "sub", [sub])`],
  [`SELECT Category, Color, AGG(Orders) o, GROUPING(Category) "all" FROM m WHERE Customer.City <> 'Paris'
    GROUP BY ROLLUP((Category, Color)) HAVING o > 1`,
    `EVALUATE SELECTCOLUMNS(CALCULATETABLE(FILTER(SUMMARIZECOLUMNS(ROLLUPADDISSUBTOTAL(ROLLUPGROUP(Category[Category], Product[Color]), "all"), "o", [Orders]), [o] > 1),
      Customer[City] <> "Paris"), "Category", Category[Category], "Color", Product[Color], "o", [o], "all", [all])`],
  // CASE, a date, an expression of aggregates.
  [`SELECT 'Date'[Month], CASE WHEN AGG(Orders) > 2 THEN 'many' ELSE 'few' END AS n,
      AGG("Sales Amount") / AGG(Orders) AS per
    FROM m WHERE 'Date'[Date] >= DATE '2024-01-01' GROUP BY ALL`,
    `EVALUATE CALCULATETABLE(SUMMARIZECOLUMNS('Date'[Month], "n", SWITCH(TRUE(), [Orders] > 2, "many", "few"), "per", [Sales Amount] / [Orders]),
      'Date'[Date] >= DATE(2024, 1, 1))`],
];

test('a SELECT answers what its DAX answers', async () => {
  for (const [sql, dax] of PAIRS) assert.deepEqual(sorted(await h.run(sql)), sorted(await h.run(dax)), sql);
});

test('ORDER BY, LIMIT and OFFSET', async () => {
  const all = await h.run(`EVALUATE SUMMARIZECOLUMNS(Product[Name], "s", [Sales Amount]) ORDER BY [s] DESC, Product[Name]`);
  assert.deepEqual(await h.run(`SELECT Product.Name, AGG("Sales Amount") s FROM m GROUP BY ALL ORDER BY s DESC, 1`), all);
  assert.deepEqual(await h.run(`SELECT Product.Name, AGG("Sales Amount") s FROM m GROUP BY ALL ORDER BY AGG("Sales Amount") DESC, Product.Name LIMIT 2 OFFSET 1`), all.slice(1, 3));
  // By an aggregate the SELECT leaves out.
  const byQty = await h.run(`EVALUATE SUMMARIZECOLUMNS(Product[Name], "s", [Sales Amount]) ORDER BY [Quantity] DESC, Product[Name]`);
  assert.deepEqual(await h.run(`SELECT Product.Name, AGG("Sales Amount") s FROM m GROUP BY ALL ORDER BY AGG(Quantity) DESC, Name`), byQty);
});

test('FETCH FIRST n ROWS WITH TIES keeps the ties, ONLY is LIMIT', async () => {
  const top = `EVALUATE TOPN(2, SUMMARIZECOLUMNS(Product[Color], "o", [Orders]), [o], DESC) ORDER BY [o] DESC, Product[Color]`;
  assert.deepEqual(await h.run(`SELECT Color, AGG(Orders) o FROM m GROUP BY ALL ORDER BY o DESC, Color FETCH FIRST 2 ROWS WITH TIES`),
    await h.run(`EVALUATE TOPN(2, SUMMARIZECOLUMNS(Product[Color], "o", [Orders]), [o], DESC, Product[Color], ASC) ORDER BY [o] DESC, Product[Color]`));
  assert.deepEqual(sorted(await h.run(`SELECT Color, AGG(Orders) o FROM m GROUP BY ALL ORDER BY o DESC FETCH FIRST 2 ROWS WITH TIES`)), sorted(await h.run(top)));
  assert.deepEqual(await h.run(`SELECT Color, AGG(Orders) o FROM m GROUP BY ALL ORDER BY o DESC, Color FETCH FIRST 2 ROWS ONLY`),
    await h.run(`SELECT Color, AGG(Orders) o FROM m GROUP BY ALL ORDER BY o DESC, Color LIMIT 2`));
});

test('a SELECT is the tree of the DAX it prints', () => {
  const t = new SqlTranslator(h.dax.model);
  const bare = x => JSON.parse(JSON.stringify(x, (k, v) => (k === 'pos' ? undefined : v)));
  for (const sql of [...PAIRS.map(([s]) => s), `SELECT Color, AGG(Orders) o FROM m GROUP BY ALL ORDER BY o DESC FETCH FIRST 2 ROWS WITH TIES`,
    `SELECT Product.Name, AGG("Sales Amount") s FROM m WHERE 'Date'[Date] >= TIMESTAMP '2024-01-01 10:30' AND Product.Name LIKE 'Mount%' GROUP BY ALL ORDER BY AGG(Quantity) DESC`]) {
    const { query } = t.translate(sql);
    assert.deepEqual(bare(parseQuery(h.dax.sqlToDax(sql).dax)), bare(query), sql);
  }
});

test('a measure keeps its own filters', async () => {
  // WHERE is the only filter: Red Sales replaces the color the WHERE asks for, as in DAX.
  const [r] = await h.run(`SELECT AGG("Red Sales") r, AGG("Sales Amount") s FROM m WHERE Product.Color = 'Black'`);
  const [d] = await h.run(`EVALUATE CALCULATETABLE(ROW("r", [Red Sales], "s", [Sales Amount]), Product[Color] = "Black")`);
  assert.deepEqual(r, d);
});

test('SQL errors carry their codes', async () => {
  const fails = async (sql, code) => {
    await assert.rejects(() => h.run(sql), e => e.name === 'DaxError' && e.code === code, sql);
  };
  await fails('SELECT Color, AGG("Sales Amount" FROM m GROUP BY ALL', 'SYNTAX');
  await fails('SELECT Color FROM m GROUP BY ALL LIMIT x', 'SYNTAX');
  await fails('SELECT Nope, AGG("Sales Amount") FROM m GROUP BY ALL', 'SEMANTIC');
  await fails('SELECT City, AGG("Sales Amount") FROM m GROUP BY ALL', 'SEMANTIC');
  await fails('SELECT Color, AGG("Sales Amount") FROM m', 'SEMANTIC');
  await fails('SELECT Color, AGG("Sales Amount") FROM m GROUP BY Category.Category', 'SEMANTIC');
  await fails('SELECT Color, "Sales Amount" FROM m GROUP BY ALL', 'SEMANTIC');
  await fails('SELECT Color, SUM("Sales Amount") FROM m GROUP BY ALL', 'SEMANTIC');
  await fails('SELECT AGG(Product.Color) FROM m', 'SEMANTIC');
  await fails("SELECT AGG('Sales Amount') FROM m", 'SEMANTIC');
  await fails(`SELECT Color FROM m WHERE AGG("Sales Amount") > 1 GROUP BY ALL`, 'SEMANTIC');
  await fails(`SELECT Color, AGG(Orders) FROM m GROUP BY ALL HAVING Customer.City = 'Paris'`, 'SEMANTIC');
  await fails('SELECT Color, AGG(Orders) AS Color FROM m GROUP BY ALL', 'SEMANTIC');
  await fails('SELECT * FROM m', 'UNSUPPORTED');
  await fails('SELECT DISTINCT Color FROM m', 'UNSUPPORTED');
  await fails('SELECT Color FROM Sales JOIN Product ON 1 = 1 GROUP BY ALL', 'UNSUPPORTED');
  await fails('SELECT COUNT(*) FROM m', 'UNSUPPORTED');
  await fails('SELECT UPPER(Color), AGG(Orders) FROM m GROUP BY ALL', 'UNSUPPORTED');
  await fails(`SELECT AGG(Orders) FROM m WHERE Product.Name LIKE 'a_c'`, 'UNSUPPORTED');
  await fails('SELECT Color, AGG(Orders) FROM m GROUP BY ALL ORDER BY Color NULLS LAST', 'UNSUPPORTED');
  await fails('SELECT Color, AGG(Orders) FROM m GROUP BY ROLLUP(Color)', 'SEMANTIC');
  await fails('SELECT Color, AGG(Orders), GROUPING(Color) g FROM m GROUP BY ALL', 'SEMANTIC');
  await fails('SELECT Color, AGG(Orders), GROUPING(Color) g FROM m GROUP BY Color, ROLLUP(Color)', 'SEMANTIC');
  await fails('SELECT Color, AGG(Orders) FROM m GROUP BY ALL FETCH FIRST 2 ROWS WITH TIES', 'SEMANTIC');
  await fails('SELECT Color, AGG(Orders) FROM m GROUP BY ALL ORDER BY 2 LIMIT 1 FETCH FIRST 2 ROWS ONLY', 'SYNTAX');
});

test('isSql and sqlToDax', () => {
  assert.equal(h.dax.isSql('  -- a comment\n select 1'), true);
  assert.equal(h.dax.isSql('EVALUATE ROW("x", 1)'), false);
  const { dax, limit, offset } = h.dax.sqlToDax('SELECT Color, AGG(Orders) FROM m GROUP BY ALL LIMIT 5');
  assert.equal(dax, `EVALUATE SUMMARIZECOLUMNS('Product'[Color], "Orders", 'Sales'[Orders])`);
  assert.deepEqual([limit, offset], [5, null]);
});

test('a SELECT over the model is a relation of any SQL', async () => {
  const st = text => h.dax.compileStatement(text);
  const run = async text => h.sql(st(text).sql);
  const byColor = await h.run(`SELECT Color, AGG(Orders) o FROM model GROUP BY ALL`);
  // A WITH's query, joined to a table of the engine; '::' and a dollar string pass through.
  const cte = await run(`WITH m AS (SELECT Color, AGG(Orders) o FROM model GROUP BY ALL)
    SELECT m.Color, m.o::INTEGER AS o, $$it's$$ AS s, p.n FROM m
    JOIN (SELECT "Color", COUNT(*) AS n FROM "Product" GROUP BY ALL) p ON p."Color" = m.Color`);
  assert.equal(cte.length, byColor.filter(r => r.Color != null).length);
  assert.ok(cte.every(r => r.s === "it's" && r.n > 0));
  // Two arms of a UNION, a FROM subquery, IN.
  const both = await run(`(SELECT Color AS k, AGG(Orders) v FROM model GROUP BY ALL)
    UNION ALL (SELECT Category.Category, AGG(Orders) FROM model GROUP BY ALL)`);
  assert.equal(both.length, byColor.length + (await h.run(`SELECT Category.Category, AGG(Orders) FROM model GROUP BY ALL`)).length);
  assert.deepEqual(sorted(await run(`SELECT * FROM (SELECT Color, AGG(Orders) o FROM model GROUP BY ALL) WHERE o > 0`)),
    sorted(byColor.filter(r => r.o > 0)));
  const top = await run(`SELECT "Name" FROM "Product" WHERE "Color" IN
    (SELECT Color FROM model GROUP BY ALL HAVING AGG(Orders) > 1) ORDER BY 1`);
  assert.ok(top.length > 0);
  // FETCH ... WITH TIES inside: the relation keeps its own rows.
  assert.deepEqual(sorted(await run(`WITH t AS (SELECT Color, AGG(Orders) o FROM model GROUP BY ALL ORDER BY o DESC FETCH FIRST 2 ROWS WITH TIES) SELECT * FROM t`)),
    sorted(await h.run(`SELECT Color, AGG(Orders) o FROM model GROUP BY ALL ORDER BY o DESC FETCH FIRST 2 ROWS WITH TIES`)));
  // Each relation's DAX, for a log.
  assert.deepEqual(st(`SELECT * FROM (SELECT Color, AGG(Orders) FROM model GROUP BY ALL)`).relations.map(r => r.dax),
    [`EVALUATE SUMMARIZECOLUMNS('Product'[Color], "Orders", 'Sales'[Orders])`]);
  // A whole SELECT over the model is compiled as compile does; SQL without the model is left as it is.
  const whole = `SELECT Color, AGG(Orders) FROM model GROUP BY ALL LIMIT 2`;
  assert.equal(st(whole).sql, h.dax.compile(whole).sql);
  for (const plain of [`SELECT 'FROM model' AS x -- FROM model\n/* (SELECT a FROM model) */`, `SELECT "model" FROM (SELECT 1 AS "model")`])
    assert.deepEqual(st(plain), { sql: plain, relations: [] });
});

test('the model is named only as a relation', () => {
  const fails = (text, code) => assert.throws(() => h.dax.compileStatement(text), e => e.name === 'DaxError' && e.code === code, text);
  fails('SELECT * FROM "Product" JOIN model ON 1 = 1', 'SEMANTIC');
  fails('SELECT Color, AGG(Orders) FROM model GROUP BY ALL UNION ALL SELECT 1, 2', 'SEMANTIC');
  fails('WITH x AS (SELECT 1) SELECT Color, AGG(Orders) FROM model GROUP BY ALL', 'SEMANTIC');
  fails('SELECT * FROM (SELECT Nope, AGG(Orders) FROM model GROUP BY ALL)', 'SEMANTIC');
  fails('SELECT * FROM (SELECT 1', 'SYNTAX');
  fails("SELECT 'x", 'SYNTAX');
  fails('EVALUATE ROW("x", 1)', 'UNSUPPORTED');
  fails('DEFINE MEASURE Sales[x] = 1 EVALUATE ROW("x", [x])', 'UNSUPPORTED');
});
