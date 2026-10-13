// SQL over the model: each SELECT answers what the DAX query it stands for answers, and its
// errors carry their codes.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness, sorted } from './helpers.js';
import { bim, setup } from './fixtures/contoso.js';

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
});

test('isSql and sqlToDax', () => {
  assert.equal(h.dax.isSql('  -- a comment\n select 1'), true);
  assert.equal(h.dax.isSql('EVALUATE ROW("x", 1)'), false);
  const { dax, limit, offset } = h.dax.sqlToDax('SELECT Color, AGG(Orders) FROM m GROUP BY ALL LIMIT 5');
  assert.equal(dax, `EVALUATE SUMMARIZECOLUMNS('Product'[Color], "Orders", 'Sales'[Orders])`);
  assert.deepEqual([limit, offset], [5, null]);
});
