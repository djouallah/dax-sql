// The query plan: drawn as relational algebra, and its SQL giving the emitter's answers.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness, sorted } from './helpers.js';
import { bim, setup } from './fixtures/contoso.js';

let h;
before(async () => { h = await harness(bim, setup); });

const Q = 'EVALUATE SUMMARIZECOLUMNS(Category[Category], TREATAS({2024}, \'Date\'[Year]), "Sales", [Sales Amount])';

test('explain draws the query plan: the groups, the measure one grouping joined to them, TREATAS a grouping of its values', () => {
  const tree = h.dax.explain(Q);
  assert.doesNotMatch(tree, /Apply|∃/);
  assert.match(tree, /^π {2}Category, Sales = sum\n└─ σ {2}sum ≠ BLANK\n/);
  assert.match(tree, /⟕ {2}Category ≡ key\n.*├─ δ {2}Distinct\n.*└─ π {2}Category\.Category\n.*└─ ▭ {2}Category\n/);
  assert.match(tree, /γ {2}by key = Category\.Category; SUM\(Sales\.Amount\) → sum/);
  assert.match(tree, /⟕ {2}Date\.Date = Sales\.OrderDate/);
  assert.match(tree, /γ {2}by key = Value; COUNT\(\*\) → count_star\n.*└─ ▭ {2}Values \{2024\}/);
});

test('before the optimizer: the measure an apply for each group, the filter a semi-join', () => {
  const tree = h.dax.explain(Q, { optimize: false });
  assert.match(tree, /×ᴬ Apply/);
  assert.match(tree, /σ {2}∃1 ∧ \(Category\.Category ≡ outer\.Category\)/);
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
