// The query plan: drawn as relational algebra, and its SQL giving the emitter's answers.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness, sorted } from './helpers.js';
import { bim, setup } from './fixtures/contoso.js';

let h;
before(async () => { h = await harness(bim, setup); });

const Q = 'EVALUATE SUMMARIZECOLUMNS(Category[Category], TREATAS({2024}, \'Date\'[Year]), "Sales", [Sales Amount])';

test('explain draws the query plan: the groups, the measure one grouping joined to them (inner: the blank rows are dropped), TREATAS a list of its values', () => {
  const tree = h.dax.explain(Q);
  assert.doesNotMatch(tree, /Apply|∃/);
  // The groups are the grouping's keys that are categories (no blank row), as the compiler's.
  assert.match(tree, /^π {2}Category, Sales = sum\n└─ ⋈ {2}\(g0 ≡ Category\) ∧ sum ≠ BLANK\n.*├─ δ {2}Distinct\n.*└─ π {2}Category = g0\n/);
  // The sales grouped by their keys first, those groups by category.
  assert.match(tree, /γ {2}by g0 = Category\.Category; SUM\(sum\) → sum\n.*└─ σ {2}Date\.Year IN \{2024\}\n/);
  assert.match(tree, /γ {2}by Sales\.OrderDate, Sales\.ProductKey; SUM\(Sales\.Amount\) → sum/);
});

test('before the optimizer: the measure one grouping by the level\'s key, joined to the groups; the year\'s dates a semi-join of the sales', () => {
  const tree = h.dax.explain(Q, { optimize: false });
  assert.doesNotMatch(tree, /×ᴬ Apply/);
  assert.match(tree, /⟕ {2}g0 ≡ Category\n/);
  assert.match(tree, /∃1 σ {2}Date\.Year IN \{2024\} ∧ \(Date\.Date = outer\.Sales\.OrderDate\)/);
});

test('the query plan\'s SQL answers as the compiled SQL does, as it is and optimized', async () => {
  for (const q of [Q,
    'EVALUATE ROW("s", [Sales Amount])',
    'EVALUATE ADDCOLUMNS(VALUES(Product[Name]), "r", RANKX(ALL(Product[Name]), [Sales Amount]))',
    'EVALUATE GROUPBY(Sales, Product[Color], "n", SUMX(CURRENTGROUP(), Sales[Qty]))',
    // Two measures over the same tables by two relationships: not one grouping.
    'EVALUATE SUMMARIZECOLUMNS(\'Date\'[Year], "o", [Sales Amount], "s", CALCULATE([Sales Amount], USERELATIONSHIP(Sales[ShipDate], \'Date\'[Date])))']) {
    const want = sorted(await h.run(q));
    for (const optimize of [false, true]) assert.deepEqual(sorted(await h.sql(h.dax.planSql(q, { optimize }).sql)), want, `${q} (optimize: ${optimize})`);
  }
});

test('plan and planSql take a SELECT over the model too', async () => {
  const q = 'SELECT Color, AGG("Sales Amount") s FROM model GROUP BY ALL';
  assert.equal(h.dax.plan(q).k, 'output');
  assert.deepEqual(sorted(await h.sql(h.dax.planSql(q).sql)), sorted(await h.run(q)));
});
