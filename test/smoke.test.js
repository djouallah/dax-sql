// Smoke tests: the compiler is not broken. Each query compiles and its SQL runs on DuckDB; the
// errors carry their codes; the SQL keeps the shape the design relies on. Whether the answers
// are DAX's is checked elsewhere.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers.js';
import { bim, setup } from './fixtures/contoso.js';

let h;
before(async () => { h = await harness(bim, setup); });

const QUERIES = [
  'EVALUATE ROW("s", [Sales Amount])',
  'EVALUATE SUMMARIZECOLUMNS(Product[Color], "s", [Sales Amount])',
  'EVALUATE SUMMARIZECOLUMNS(Category[Category], Customer[City], "s", [Sales Amount], "o", [Orders])',
  'EVALUATE SUMMARIZECOLUMNS(ROLLUPADDISSUBTOTAL(Category[Category], "t"), "s", [Sales Amount], "in", ISINSCOPE(Category[Category]))',
  'EVALUATE SUMMARIZECOLUMNS(Product[Color], "share", DIVIDE([Sales Amount], CALCULATE([Sales Amount], ALLSELECTED(Product))))',
  'EVALUATE SUMMARIZECOLUMNS(Product[Name], TREATAS({"Paris"}, Customer[City]), TREATAS({"Red"}, Product[Color]), "s", [Sales Amount], "a", CALCULATE([Sales Amount], ALL(Customer)), "n", COUNTROWS(ALLSELECTED(Customer)))',
  'EVALUATE ROW("k", CALCULATE([Sales Amount], KEEPFILTERS(Product[Color] = "Red")), "a", CALCULATE([Sales Amount], ALL(Sales)))',
  'EVALUATE ROW("u", CALCULATE([Sales Amount], USERELATIONSHIP(Sales[ShipDate], \'Date\'[Date])), "c", CALCULATE(COUNTROWS(Customer), CROSSFILTER(Sales[CustomerKey], Customer[CustomerKey], BOTH)))',
  'EVALUATE ROW("m", MAXX(VALUES(Customer[Customer]), [Sales Amount]), "f", COUNTROWS(FILTER(Product, [Sales Amount] > 100)))',
  'EVALUATE ADDCOLUMNS(SUMMARIZE(Sales, Product[Color], Customer[City]), "s", [Sales Amount])',
  'EVALUATE GROUPBY(Sales, Product[Color], "n", SUMX(CURRENTGROUP(), Sales[Qty]))',
  'EVALUATE GENERATE(VALUES(Category[Category]), TOPN(1, VALUES(Product[Name]), [Sales Amount]))',
  'EVALUATE ADDCOLUMNS(VALUES(Product[Name]), "r", RANKX(ALL(Product[Name]), [Sales Amount]))',
  'EVALUATE SUMMARIZECOLUMNS(\'Date\'[Year], \'Date\'[Month], "ytd", TOTALYTD([Sales Amount], \'Date\'[Date]), "py", CALCULATE([Sales Amount], SAMEPERIODLASTYEAR(\'Date\'[Date])))',
  'EVALUATE ROW("p", CALCULATE([Sales Amount], DATESINPERIOD(\'Date\'[Date], DATE(2024, 3, 31), -3, MONTH)), "m", CALCULATE([Sales Amount], PREVIOUSMONTH(\'Date\'[Date])))',
  'EVALUATE UNION(EXCEPT(VALUES(Product[Color]), {"Red"}), INTERSECT(VALUES(Customer[City]), {"Paris"}))',
  'EVALUATE ROW("v", SELECTEDVALUE(Product[Color], "many"), "l", LOOKUPVALUE(Product[Price], Product[Name], "Cap"), "c", CONCATENATEX(VALUES(Customer[City]), Customer[City], ", "))',
  'EVALUATE ADDCOLUMNS(VALUES(\'Date\'[Month]), "prev", CALCULATE([Sales Amount], OFFSET(-1, ALLSELECTED(\'Date\'[Month]), ORDERBY(\'Date\'[Month]))))',
  'EVALUATE ADDCOLUMNS(VALUES(Product[Name]), "r", RANK(DENSE, ALL(Product[Name]), ORDERBY([Sales Amount], DESC)))',
  'EVALUATE ROW("f", FORMAT(1234.5, "#,##0.00"), "d", FORMAT(DATE(2024, 1, 5), "yyyy-mm-dd"), "t", "x" & BLANK())',
  'EVALUATE ADDCOLUMNS(VALUES(Product[Name]), "l", LEN(Product[Name]), "x", FIXED([Sales Amount], 1, TRUE), "f", FIND("a", Product[Name], 1, 0))',
  'DEFINE MEASURE Sales[Twice] = [Sales Amount] * 2 VAR x = 3 EVALUATE ROW("t", [Twice] + x)',
  'EVALUATE DATATABLE("a", INTEGER, "b", STRING, {{1, "x"}, {2, "y"}})',
  'EVALUATE TOPN(2, SUMMARIZECOLUMNS(Product[Name], "s", [Sales Amount]), [s], DESC) ORDER BY [s] DESC',
  'EVALUATE SUMMARIZECOLUMNS(Product[Color], "p", PERCENTILEX.INC(VALUES(Customer[City]), [Sales Amount], 0.3), "m", MEDIANX(VALUES(Customer[City]), [Sales Amount]), "c", PERCENTILE.EXC(Sales[Amount], 0.5), "a", AVERAGEX(Sales, Sales[Amount] * 1.5))',
];

test('the queries compile and run', async () => {
  for (const q of QUERIES) {
    const rows = await h.run(q);
    assert.ok(Array.isArray(rows), q);
  }
});

test('with a role, the queries compile and run', async () => {
  const roles = (bim.model.roles ?? []).map(r => r.name).filter(n => n !== 'Me');
  for (const role of roles) {
    const hr = await harness(bim, setup, { roles: role });
    for (const q of QUERIES.slice(0, 6)) assert.ok(Array.isArray(await hr.run(q)), `${role}: ${q}`);
  }
});

test('errors carry their codes', async () => {
  const fails = async (dax, code) => {
    await assert.rejects(() => h.run(dax), e => e.name === 'DaxError' && e.code === code, dax);
  };
  await fails('EVALUATE ROW("x", NOSUCHFUNCTION(1))', 'UNSUPPORTED');
  await fails('EVALUATE ROW("x", [No such measure])', 'SEMANTIC');
  await fails('EVALUATE ROW("x", Sales[Qty])', 'SEMANTIC');
  await fails('EVALUATE ROW("x", SUM(Sales[Qty]', 'SYNTAX');
  // What DAX rejects though the rest of the query could be answered.
  await fails('EVALUATE ROW("x", CALCULATE([Sales Amount], Sales[Qty] > [Sales Amount]))', 'SEMANTIC');
  await fails('EVALUATE ROW("x", SUMX({1, 2}, CALCULATE([Sales Amount], Sales[Qty] = [Value])))', 'SEMANTIC');
  await fails('EVALUATE GROUPBY(Sales, Product[Color], "n", CONCATENATEX(CURRENTGROUP(), Sales[Qty], ","))', 'SEMANTIC');
  await fails('EVALUATE ROW("x", CALCULATE(SUMX(Sales, RELATED(Product[Price])), CROSSFILTER(Sales[ProductKey], Product[ProductKey], None)))', 'SEMANTIC');
  await fails('EVALUATE OFFSET(-1, ALL(Product), ORDERBY(Product[Price]), PARTITIONBY(Category[Category]))', 'SEMANTIC');
});

test('the SQL keeps its shape', async () => {
  // A filter of a column's values on the column alone is a condition on the fact's own rows
  // when its keys are the dimension's: no subquery. A measure in the condition keeps one.
  const ri = await harness(bim, setup, { assumeIntegrity: true });
  assert.doesNotMatch(ri.dax.compile(`EVALUATE ROW("f", CALCULATE([Sales Amount], FILTER(ALL('Date'[Date]), 'Date'[Date] >= DATE(2024, 1, 1))))`).sql, /IN \(SELECT/);
  assert.match(ri.dax.compile(`EVALUATE ROW("m", CALCULATE([Sales Amount], FILTER(ALL('Date'[Year]), [Orders] > 3)))`).sql, /IN \(SELECT/);
  // A total over what is selected, next to the groups, is read off them: one scan of the sales.
  const q = `EVALUATE SUMMARIZECOLUMNS(Product[Color], "s", [Sales Amount],
    "share", DIVIDE([Sales Amount], CALCULATE([Sales Amount], ALLSELECTED(Product))))`;
  assert.equal(h.dax.compile(q).sql.match(/FROM "Sales" AS t/g).length, 1);
});
