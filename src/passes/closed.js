// An EXISTS that reads a value of one row the rows around it hold but that reads none of them (the
// last date of the date table, under TOTALYTD), as the correlated plan's:
//
//   σ_{EXISTS(q(x, c))}(L ×ᴬ C)  →  σ_{EXISTS(C' ×ᴬ q(x, c'))}(L ×ᴬ C)
//
// C a grouping of no key (one row) reading no column from outside, C' a copy of it under columns
// of its own. The EXISTS then reads of its rows only what it matches them by (x): unnested by an
// engine, a semi join on x over x's values, not one on x and c for each of L's rows (a mark join of
// every row of a fact table for a constant). What reads nothing of C any more no longer applies it
// (prune).
import * as P from '../plan.js';
import { mapKids, mapScalars, free, subst } from './decorrelate.js';
import { clone } from './clone.js';

// A relation of one row (a grouping of no key, or one under a π) that reads nothing from outside.
const closedOne = r => ((r.k === 'aggregate' && !r.keys.length) || (r.k === 'project' && closedOne(r.src))) && !free(r).size;

export function closed(root) {
  const S = (x, cs) => {
    if (!x || typeof x !== 'object') return x;
    if (x.k === 'exists') return { ...x, rel: R(lift(x.rel, cs)) };
    if (x.k === 'op' || x.k === 'fn' || x.k === 'pop') return { ...x, a: x.a.map(y => S(y, cs)) };
    if (x.k === 'case') return { ...x, w: x.w.map(([c, v]) => [S(c, cs), S(v, cs)]), e: S(x.e, cs) };
    return x;
  };
  const R = r => {
    r = mapKids(r, R);
    if (r.k !== 'select') return mapScalars(r, x => S(x, []));
    return { ...r, pred: S(r.pred, onesBelow(r.src)) };
  };
  for (const d of root.defs ?? []) d.rel = R(d.rel);
  return { ...root, src: R(root.src) };
}

// The closed relations of one row applied in r's rows (through σ, π and the left of applies).
function onesBelow(r, out = []) {
  if (r.k === 'apply' && !r.outer) {
    if (closedOne(r.right)) out.push(r.right);
    return onesBelow(r.left, out);
  }
  if (r.k === 'select' || r.k === 'project') return onesBelow(r.src, out);
  return out;
}

// rel, each closed relation of one row it reads the columns of a copy of, applied below the σ over
// it that read none of them (the match of the EXISTS' rows to the rows around, x = outer.x, stays
// on top: an IN).
function lift(rel, cs) {
  for (const c of cs) {
    if (!c.cols.some(col => free(rel).has(col))) continue;
    const { rel: copy, map } = clone(c);
    const under = r => {
      if (r.k === 'select' && !c.cols.some(col => free(P.select(P.oneRow(), r.pred)).has(col))) {
        const src = under(r.src);
        return P.select(src, r.pred);
      }
      return P.apply(copy, subst(P.exists(r), map).rel);
    };
    rel = under(rel);
  }
  return rel;
}
