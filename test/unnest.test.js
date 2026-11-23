// The correlated plan unnested (src/passes/unnest.js): no apply and no correlated EXISTS left,
// and the same answers as the compiled SQL.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness, sorted } from './helpers.js';
import { bim, setup } from './fixtures/contoso.js';
import { kids, scalarsOf, free } from '../src/passes/decorrelate.js';

let h;
before(async () => { h = await harness(bim, setup); });

// The applies and correlated EXISTS a plan holds.
function left(plan) {
  let n = 0;
  const seen = new Set();
  const R = r => { if (seen.has(r)) return; seen.add(r); if (r.k === 'apply') n++; kids(r).forEach(R); scalarsOf(r).forEach(S); };
  const S = x => {
    if (!x || typeof x !== 'object') return;
    if (x.k === 'exists') { if (free(x.rel).size) n++; R(x.rel); }
    (x.a ?? []).forEach(S); (x.w ?? []).flat().forEach(S); S(x.e);
  };
  R(plan.src);
  (plan.defs ?? []).forEach(d => R(d.rel));
  return n;
}

const QUERIES = [
  // A measure of each row: one grouping by the row's key, left-joined (no D).
  'EVALUATE ADDCOLUMNS(VALUES(Product[Color]), "s", [Sales Amount])',
  // A rank: the measure of each row of ALL beside each row (two levels).
  'EVALUATE ADDCOLUMNS(VALUES(Product[Name]), "r", RANKX(ALL(Product[Name]), [Sales Amount]))',
  // An iterator over the rows of a row, a measure of each (an apply in an apply's right).
  'EVALUATE ADDCOLUMNS(VALUES(Product[Color]), "m", MAXX(VALUES(Product[Name]), [Sales Amount]))',
  // A range: the dates up to the row's (D joined on the condition).
  'EVALUATE ADDCOLUMNS(VALUES(\'Date\'[Year]), "c", CALCULATE([Sales Amount], FILTER(ALL(\'Date\'[Year]), \'Date\'[Year] <= EARLIER(\'Date\'[Year]))))',
  // A filter by a measure: an EXISTS of the row's rows.
  'EVALUATE FILTER(VALUES(Product[Name]), CALCULATE(COUNTROWS(Sales)) > 0)',
  // A table of each row (GENERATE): a lateral join.
  'EVALUATE GENERATE(VALUES(Product[Color]), TOPN(1, VALUES(Product[Name]), [Sales Amount]))',
];

test('the unnested plan holds no apply and no correlated EXISTS, and answers as the compiled SQL', async () => {
  for (const q of QUERIES) {
    assert.equal(left(h.dax.plan(q, { unnest: true })), 0, q);
    assert.deepEqual(sorted(await h.sql(h.dax.planSql(q, { unnest: true }).sql)), sorted(await h.run(q)), q);
  }
});
