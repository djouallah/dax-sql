// The query plan's structure (src/check.js) and its Substrait round trip, on the contoso fixture:
//   - every query's plan, as lowered and after each pipeline (correlated, unnested, optimized),
//     is a well-formed plan, with no DAX operator left once the passes ran;
//   - the check finds a plan that is not (a column read that no input has, a relation's columns
//     not its operator's, a union's or a definition's columns that are not its branches');
//   - each plan comes back from Substrait as it went (conformance/tools/substrait-roundtrip.mjs,
//     which CI runs over the whole suite).
// CI also runs the suite with DAXSQL_CHECK set (conformance.yml), every pass's plan checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCompiler } from '../src/index.js';
import { tmslToModel } from '../formats/tmsl.js';
import { checkPlan } from '../src/check.js';
import { roundTrip, MODES } from '../conformance/tools/substrait-roundtrip.mjs';
import { bim } from './fixtures/contoso.js';

const c = createCompiler(tmslToModel(bim));
const QUERIES = [
  'EVALUATE ROW("s", [Sales Amount])',
  'EVALUATE SUMMARIZECOLUMNS(Category[Category], Customer[City], "s", [Sales Amount], "o", [Orders])',
  'EVALUATE SUMMARIZECOLUMNS(ROLLUPADDISSUBTOTAL(Category[Category], "t"), "s", [Sales Amount], "in", ISINSCOPE(Category[Category]))',
  'EVALUATE SUMMARIZECOLUMNS(Product[Color], "share", DIVIDE([Sales Amount], CALCULATE([Sales Amount], ALLSELECTED(Product))))',
  'EVALUATE SUMMARIZECOLUMNS(Product[Name], TREATAS({"Paris"}, Customer[City]), "s", [Sales Amount], "a", CALCULATE([Sales Amount], ALL(Customer)))',
  'EVALUATE ROW("k", CALCULATE([Sales Amount], KEEPFILTERS(Product[Color] = "Red")), "a", CALCULATE([Sales Amount], ALL(Sales)))',
  'EVALUATE ROW("u", CALCULATE([Sales Amount], USERELATIONSHIP(Sales[ShipDate], \'Date\'[Date])))',
  'EVALUATE ROW("m", MAXX(VALUES(Customer[Customer]), [Sales Amount]), "f", COUNTROWS(FILTER(Product, [Sales Amount] > 100)))',
  'EVALUATE ADDCOLUMNS(SUMMARIZE(Sales, Product[Color], Customer[City]), "s", [Sales Amount])',
  'EVALUATE GROUPBY(Sales, Product[Color], "n", SUMX(CURRENTGROUP(), Sales[Qty]))',
  'EVALUATE GENERATE(VALUES(Category[Category]), TOPN(1, VALUES(Product[Name]), [Sales Amount]))',
  'EVALUATE ADDCOLUMNS(VALUES(Product[Name]), "r", RANKX(ALL(Product[Name]), [Sales Amount]))',
  'EVALUATE UNION(EXCEPT(VALUES(Product[Color]), {"Red"}), INTERSECT(VALUES(Customer[City]), {"Paris"}))',
  'EVALUATE ROW("v", SELECTEDVALUE(Product[Color], "many"), "c", CONCATENATEX(VALUES(Customer[City]), Customer[City], ", "))',
  'EVALUATE ADDCOLUMNS(VALUES(Product[Name]), "r", RANK(DENSE, ALL(Product[Name]), ORDERBY([Sales Amount], DESC)))',
  'EVALUATE ROW("f", FORMAT(1234.5, "#,##0.00"), "d", FORMAT(DATE(2024, 1, 5), "yyyy-mm-dd"), "t", "x" & BLANK())',
  'EVALUATE TOPN(2, SUMMARIZECOLUMNS(Product[Name], "s", [Sales Amount]), [s], DESC) ORDER BY [s] DESC',
  'EVALUATE SUMMARIZECOLUMNS(Product[Color], "p", PERCENTILEX.INC(VALUES(Customer[City]), [Sales Amount], 0.3), "m", MEDIANX(VALUES(Customer[City]), [Sales Amount]))',
  'EVALUATE SUMMARIZECOLUMNS(Product[Color], "w", SWITCH(TRUE(), ISINSCOPE(Product[Color]), [Sales Amount], 1.5) / 3, "d", DIVIDE([Sales Amount], [Orders]))',
  'EVALUATE SUMMARIZECOLUMNS(Customer[City], "t", [Target], "n", CALCULATE([Sales Amount], ALLNOBLANKROW(Customer)))',
  'EVALUATE OFFSET(-1, ALL(Product[Name], Product[Price]), ORDERBY(Product[Price]))',
  'EVALUATE VAR t = FILTER(VALUES(Product[Color]), [Sales Amount] > 0) RETURN ADDCOLUMNS(t, "s", [Sales Amount], "n", COUNTROWS(t))',
  'EVALUATE ROW("y", TOTALYTD([Sales Amount], \'Date\'[Date]), "p", CALCULATE([Sales Amount], SAMEPERIODLASTYEAR(\'Date\'[Date])))',
  'SELECT Product.Color, AGG("Sales Amount") FROM model GROUP BY ALL ORDER BY 1',
];

test('every plan is well formed: as lowered, and after each pipeline, with no DAX operator left', () => {
  for (const q of QUERIES) {
    checkPlan(c.plan(q, { optimize: false }), { stage: `${q} as lowered` });
    for (const [mode, o] of Object.entries(MODES)) checkPlan(c.plan(q, o), { stage: `${q} ${mode}`, final: true });
  }
});

test('every plan comes back from Substrait as it went: correlated, unnested, optimized', () => {
  for (const q of QUERIES) for (const mode of Object.keys(MODES)) assert.equal(roundTrip(c, q, mode), null, `${q} (${mode})`);
});

// A plan broken one way, and what the check says of it.
const Q = 'EVALUATE SUMMARIZECOLUMNS(Category[Category], "s", [Sales Amount], "o", [Orders])';
const broken = (q, mode, f) => {
  const p = c.plan(q, MODES[mode]);
  f(p);
  return () => checkPlan(p, { stage: 'broken', final: true });
};
const find = (r, k, seen = new Set()) => {
  if (!r || typeof r !== 'object' || seen.has(r)) return null;
  seen.add(r);
  if (r.k === k) return r;
  for (const x of [r.src, r.left, r.right, ...(r.srcs ?? []), ...(r.defs ?? []).map(d => d.rel)]) {
    const f = find(x, k, seen);
    if (f) return f;
  }
  return null;
};

test('the check finds a column read that no input has', () => {
  assert.throws(broken(Q, 'unnest', p => {
    const x = find(p, 'project');
    x.items[0] = { ...x.items[0], expr: { k: 'ref', col: { id: -1, name: 'ghost', t: 'int' }, t: 'int' } };
  }), /plan check \(broken\): project reads column ghost#-1, which none of its inputs has/);
});

test('the check finds a relation whose columns are not its operator\'s', () => {
  assert.throws(broken(Q, 'unnest', p => { const j = find(p, 'join'); j.cols = j.cols.slice(1); }), /join: its columns .* are not the left's then the right's/);
  assert.throws(broken(Q, 'unnest', p => { const a = find(p, 'aggregate'); a.cols = [...a.cols].reverse(); }), /aggregate: its columns .* are not its keys' then its aggregates'/);
  assert.throws(broken(Q, 'unnest', p => { const j = find(p, 'join'); j.cols = [...j.cols, j.cols[0]]; }), /join has a column twice/);
});

test('the check finds a union or a definition read wrong, and a DAX operator left after the passes', () => {
  const U = 'EVALUATE UNION(VALUES(Product[Color]), VALUES(Customer[City]))';
  assert.throws(broken(U, 'unnest', p => { const u = find(p, 'union'); u.picks[1] = u.picks[0]; }), /union: branch 2 gives a column it does not have/);
  const V = 'EVALUATE VAR t = FILTER(VALUES(Product[Color]), [Sales Amount] > 0) RETURN ADDCOLUMNS(t, "n", COUNTROWS(t))';
  assert.throws(broken(V, 'correlated', p => { const s = find(p, 'shared'); s.def = { rel: s.def.rel, n: 99 }; }), /a use of a definition the query does not have/);
  assert.throws(broken(Q, 'unnest', p => { p.items[1] = { ...p.items[1], expr: { k: 'fn', name: 'SUM', a: [], t: 'int' } }; }), /output still has DAX's fn SUM/);
  assert.throws(() => checkPlan({ k: 'project', cols: [] }), /the root is project, not output/);
});

// A total's measures are its rows: no one row crossed with them, nor applied to them, in any plan
// (a block of no FROM is one row; one row × R is R). Two groupings that are not one are crossed.
test('a total is its groupings: no one row under them, as lowered or after any pipeline', () => {
  const TOTALS = [
    'EVALUATE ROW("q", [Quantity], "s", [Sales Amount])',
    'EVALUATE { [Quantity] }',
    'EVALUATE SUMMARIZECOLUMNS("q", [Quantity])',
    'EVALUATE SUMMARIZECOLUMNS(ROLLUPADDISSUBTOTAL(Product[Color], "t"), "q", [Quantity])',
    'EVALUATE ROW("x", MAXX(VALUES(Product[Color]), [Quantity]))',
    'EVALUATE ROW("p", PERCENTILE.INC(Sales[Qty], 0.5), "q", [Quantity])',
    'EVALUATE ROW("d", DISTINCTCOUNT(Sales[CustomerKey]), "n", COUNTROWS(VALUES(Product[Color])))',
    'SELECT AGG(Quantity) AS q FROM m',
  ];
  for (const q of TOTALS) {
    for (const o of [{ optimize: false }, ...Object.values(MODES)]) assert.doesNotMatch(c.explain(q, o), /One row/, `${q} ${JSON.stringify(o)}`);
  }
  assert.equal(c.explain(TOTALS[5], MODES.unnest).match(/Cross join/g)?.length, 1, 'a percentile and a sum: two groupings, one cross join');
});
