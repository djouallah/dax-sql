// Correlated EXISTS that match a row by columns of its own, as joins (the correlated plan's: DuckDB
// unnests what is left):
//
//   σ_{EXISTS(σ x₁ ≡ a₁ ∧ … ∧ xₙ ≡ aₙ ∧ q (R))}(S)  →  S ⋈ δ(π_{a₁…aₙ} σ_q R) on x₁ ≡ a₁ ∧ … ∧ xₙ ≡ aₙ
//
// for n ≥ 2 (a row matched by its identity: the TREATAS of a table's columns), x the rows' columns (S's), a of R's alone, q reading none of S's (a column of the rows around S,
// it may: the join is then over the values of those rows). The distinct rows of R's values keep
// each row of S once. Unnested by an engine, the EXISTS is a semi join of S's rows for each value
// of the rows around them, every one of S's rows crossed with those values first: on rows that a
// TREATAS of many columns matches (the SQL front end's AGG over a join), a product of millions.
import * as P from '../plan.js';
import { mapKids, mapScalars, conjuncts, refsOf, free } from './decorrelate.js';

export function semijoins(root) {
  const S = x => {
    if (!x || typeof x !== 'object') return x;
    if (x.k === 'exists') return { ...x, rel: R(x.rel) };
    if (x.k === 'op' || x.k === 'fn' || x.k === 'pop') return { ...x, a: x.a.map(S) };
    if (x.k === 'case') return { ...x, w: x.w.map(([c, v]) => [S(c), S(v)]), e: S(x.e) };
    return x;
  };
  const R = r => {
    r = mapScalars(mapKids(r, R), S);
    if (r.k !== 'select') return r;
    let src = r.src;
    const keep = [];
    for (const c of conjuncts(r.pred)) {
      const j = semi(src, c);
      if (j) src = j; else keep.push(c);
    }
    if (src === r.src) return r;
    return keep.length ? P.select(src, P.and(keep)) : src;
  };
  for (const d of root.defs ?? []) d.rel = R(d.rel);
  return { ...root, src: R(root.src) };
}

// S ⋈ δ(π_a σ_q R) for the condition c of S's rows, or null when c is not of that kind.
function semi(src, c) {
  if (c.k !== 'exists' || c.rel.k !== 'select') return null;
  const mine = new Set(src.cols), R = c.rel.src, theirs = new Set(R.cols);
  if ([...free(R)].some(col => mine.has(col))) return null;
  const ofR = x => refsOf(x).size > 0 && [...refsOf(x)].every(col => theirs.has(col)) && !hasExists(x);
  const keys = [], rest = [];
  for (const e of conjuncts(c.rel.pred)) {
    const m = e.k === 'op' && e.op === 'eqs' ? P.key : e.k === 'pop' && (e.op === 'eq' || e.op === 'key') ? (e.op === 'eq' ? P.eq : P.key) : null;
    const [l, r] = m ? e.a : [];
    const pair = !m ? null : l.k === 'ref' && mine.has(l.col) && ofR(r) ? [l, r] : r.k === 'ref' && mine.has(r.col) && ofR(l) ? [r, l] : null;
    if (pair) keys.push({ x: pair[0], a: pair[1], m });
    else rest.push(e);
  }
  // One column DuckDB matches as it is (a mark join on it, for each value of the rows around);
  // several (a row's identity: TREATAS of a table's columns), it crosses the rows with those values.
  if (keys.length < 2) return null;
  const inner = rest.length ? P.select(R, P.and(rest)) : R;
  if ([...free(inner)].some(col => mine.has(col))) return null;
  const vals = P.distinct(P.project(inner, keys.map((k, i) => ({ name: `${k.x.col.name}_${i}`, expr: k.a, t: k.x.col.t }))));
  const j = P.join('inner', src, vals, P.and(keys.map((k, i) => k.m(P.ref(k.x.col), P.ref(vals.cols[i])))));
  return P.projectAs(j, src.cols.map(col => ({ col, expr: P.ref(col) })));
}

function hasExists(x) {
  if (!x || typeof x !== 'object') return false;
  if (x.k === 'exists') return true;
  if (x.k === 'op' || x.k === 'fn' || x.k === 'pop') return x.a.some(hasExists);
  if (x.k === 'case') return x.w.some(([c, v]) => hasExists(c) || hasExists(v)) || hasExists(x.e);
  return false;
}
