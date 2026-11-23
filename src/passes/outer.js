// Outer joins and cross joins, for every engine. Two classic rewrites, each giving the same rows:
//
// - A filter that rejects the rows whose right side is all NULL (the measures of a
//   SUMMARIZECOLUMNS' groups, a row kept when one is not blank) over a left join: the join is
//   an inner join (the rows it adds, NULL on the right, are the ones the filter drops).
// - An inner join of a cross join X × Y with G, on conditions between X and G and between Y and
//   G: (X ⋈ G) ⋈ Y, each side matched on its own keys (the groups of two tables' columns
//   crossed, then matched to the measures' grouping: the cross product never made).
import * as P from '../plan.js';
import { mapKids } from './decorrelate.js';

export function outer(root) {
  const O = r => {
    r = mapKids(r, O);
    // The filter over the left join, or over projections of it (their values read in its place).
    if (r.k === 'select') {
      const chain = [];
      let s = r.src, pred = r.pred;
      while (s.k === 'project') { const m = new Map(s.items.map(i => [i.col, i.expr])); pred = put(pred, m); chain.push(s); s = s.src; }
      if (s.k === 'join' && s.kind === 'left' && rejectsNull(pred, new Set(s.right.cols))) {
        const inner = uncross(P.join('inner', s.left, s.right, s.on));
        const src = chain.reduceRight((below, p) => ({ ...p, src: below }), inner);
        return { ...r, src, cols: src.cols };
      }
    }
    if (r.k === 'join' && r.kind === 'inner') return uncross(r);
    return r;
  };
  for (const d of root.defs ?? []) d.rel = O(d.rel);
  return { ...root, src: O(root.src) };
}

// (X × Y) ⋈ G on conditions between X and G and between Y and G -> (X ⋈ G) ⋈ Y (and G on
// the left, the same); again for what X is a cross join of.
function uncross(j) {
  if (j.k !== 'join' || j.kind !== 'inner' || !j.on) return j;
  const flip = j.right.k === 'join' && j.right.kind === 'cross' && !(j.left.k === 'join' && j.left.kind === 'cross');
  const cross = flip ? j.right : j.left, g = flip ? j.left : j.right;
  if (cross.k !== 'join' || cross.kind !== 'cross') return j;
  const X = new Set(cross.left.cols), Y = new Set(cross.right.cols), G = new Set(g.cols);
  const cs = conjuncts(j.on);
  const within = (c, ...sides) => { const f = refs(c); return [...f].every(col => sides.some(s => s.has(col))); };
  const touches = (c, s) => [...refs(c)].some(col => s.has(col));
  const xg = cs.filter(c => within(c, X, G) && touches(c, X) && touches(c, G));
  const yg = cs.filter(c => within(c, Y, G) && touches(c, Y) && touches(c, G));
  if (!xg.length || !yg.length || cs.some(c => touches(c, X) && touches(c, Y))) return j;
  const inner = cs.filter(c => within(c, X, G));
  const inside = uncross(P.join('inner', cross.left, g, P.and(inner)));
  return uncross(P.join('inner', inside, cross.right, P.and(cs.filter(c => !inner.includes(c)))));
}

// Whether a condition is false or unknown when the columns `nulls` are all NULL: a test that one
// is not NULL, a comparison reading one (NULL compared is unknown), an AND with such a term, an
// OR of such terms. (≡, a blank matching a blank, is not one.)
function rejectsNull(x, nulls) {
  if (!x || x.k !== 'pop') return false;
  switch (x.op) {
    case 'notnull': return reads(x.a[0], nulls);
    case 'eq': case 'ne': case 'lt': case 'le': case 'gt': case 'ge': return x.a.some(y => readsOnly(y, nulls));
    case 'and': return x.a.some(y => rejectsNull(y, nulls));
    case 'or': return x.a.every(y => rejectsNull(y, nulls));
  }
  return false;
}
// A value NULL when `nulls` are: a column of them, or arithmetic over one.
function readsOnly(x, nulls) {
  if (x.k === 'ref') return nulls.has(x.col);
  if (x.k === 'pop' && ['add', 'sub', 'mul', 'div', 'neg', 'cast'].includes(x.op)) return x.a.some(y => readsOnly(y, nulls));
  return false;
}
const reads = (x, nulls) => readsOnly(x, nulls);
const conjuncts = x => (x.k === 'pop' && x.op === 'and' ? x.a.flatMap(conjuncts) : [x]);
function refs(x, out = new Set()) {
  if (!x || typeof x !== 'object') return out;
  if (x.k === 'ref') out.add(x.col);
  if (x.k === 'case') { x.w.forEach(([c, v]) => { refs(c, out); refs(v, out); }); refs(x.e, out); }
  if (Array.isArray(x.a)) x.a.forEach(y => refs(y, out));
  return out;
}
// A scalar with the columns of `m` as their values.
function put(x, m) {
  if (!x || typeof x !== 'object') return x;
  if (x.k === 'ref') return m.has(x.col) ? m.get(x.col) : x;
  if (x.k === 'case') return { ...x, w: x.w.map(([c, v]) => [put(c, m), put(v, m)]), e: put(x.e, m) };
  if (Array.isArray(x.a)) return { ...x, a: x.a.map(y => put(y, m)) };
  return x;
}
