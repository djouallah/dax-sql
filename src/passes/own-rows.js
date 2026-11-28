// A scan matched on all its columns to rows of its own table that joins extended: the rows of
// the scan whose own extension holds the condition (grid-0049: the SQL front end's TREATAS of all
// 16 columns of catalog_sales from the rows of catalog_sales ⋈ promotion ⋈ item, a DISTINCT of
// 14 M rows and a join on 16 columns, for SUM over the join the hand writes).
//
//   σ ∃(σ (S'.c ≡ S.c, every c) ∧ p (S' ⋈ T…)) (S)   =   σ ∃(σp(T…)) (S), T… reading S's row for S'
//
// S and S' scans of the same table, every stored column. Two rows alike in every column have
// the same extensions (the joins and conditions read the same values), so a row of S matches a
// row of S' ⋈ T… holding p exactly when one of its own extensions holds p: no key need be
// unique. What is between the EXISTS and S' must be row-wise: σ, π, an inner apply or join to
// other rows, a definition's read. (The semijoins pass would make the EXISTS a join on every
// column, of the distinct rows of S' ⋈ T…: a DISTINCT of the whole fact.)
import * as P from '../plan.js';
import { mapKids, mapScalars, subst, conjuncts, made, refsOf, existsOf } from './decorrelate.js';
import { clone } from './clone.js';

export function ownRows(root) {
  const memo = new Map();
  const W = r => {
    if (memo.has(r)) return memo.get(r);
    const kidsDone = mapKids(r, W);
    const out = rewrite(kidsDone) ?? kidsDone;
    memo.set(r, out);
    return out;
  };
  const defs = (root.defs ?? []).map(d => { d.rel = W(d.rel); return d; });
  return { ...W(root), defs };
}

// A relation reading `map`'s columns as others (col -> col), an EXISTS' relation too.
const substRel = (r, map) => mapScalars(mapKids(r, k => substRel(k, map)), x => subst(x, map));
const stored = t => t.columns.filter(c => !c.expr);
// (An EXISTS in a condition: kept where it is, it may read anything below.)
const existsIn = c => existsOf(c).length > 0;
const isMatch = x => (x.k === 'op' && x.op === 'eqs') || (x.k === 'pop' && x.op === 'key');

// σ(S) whose condition holds an EXISTS of rows of S's table (S' in them) matched to S's row on
// every column: that EXISTS of the row's own extensions, the matches gone (true of the row itself).
function rewrite(r) {
  if (r.k !== 'select' || r.src.k !== 'scan') return null;
  const S = r.src, all = stored(S.table);
  if (all.length !== S.cols.length || !all.every(c => S.cols.some(x => x.lineage === c))) return null;
  let changed = false;
  const parts = conjuncts(r.pred).map(c => {
    if (c.k !== 'exists') return c;
    const x = ownExists(c.rel, S);
    if (!x) return c;
    changed = true;
    return x;
  });
  return changed ? P.select(S, P.and(parts)) : null;
}

function ownExists(rel, S) {
  const ext = extension(rel, S);
  if (!ext) return null;
  const matched = new Set(), rest = [];
  for (const c of ext.conds.flatMap(conjuncts)) {
    if (isMatch(c) && c.a[0].k === 'ref' && c.a[1].k === 'ref' && c.a[0].col === c.a[1].col && S.cols.includes(c.a[0].col)) matched.add(c.a[0].col);
    else rest.push(c);
  }
  if (!S.cols.every(c => matched.has(c))) return null;
  if (!ext.rel) return rest.length ? P.and(rest) : P.TRUE;
  return P.exists(rest.length ? P.select(ext.rel, P.and(rest)) : ext.rel);
}

// r as the extension of one row of S's table (S' in it, row-wise above it): { rel, conds, row },
// rel the rows the joins add (null: none), conds what must hold (of S's row and rel), row the
// columns of r that are S's (col -> S's column). Null when r is not one.
function extension(r, S) {
  switch (r.k) {
    case 'scan': {
      if (r.table !== S.table) return null;
      const row = new Map();
      for (const c of r.cols) {
        const s = S.cols.find(x => x.lineage === c.lineage);
        if (!s) return null;
        row.set(c, s);
      }
      return { rel: null, conds: [], row };
    }
    case 'shared': {
      const { rel: copy, map } = clone(r.def.rel);
      const e = extension(copy, S);
      if (!e) return null;
      // The read's columns: S's, or the definition's (copied) others.
      const row = new Map(), items = [];
      r.cols.forEach((c, i) => {
        const at = map.get(r.picks[i]) ?? r.picks[i];
        if (e.row.has(at)) row.set(c, e.row.get(at));
        else items.push({ col: c, expr: P.ref(at) });
      });
      if (items.length && !e.rel) return null;
      return { rel: items.length ? P.projectAs(e.rel, items) : e.rel, conds: e.conds, row };
    }
    case 'select': {
      // A condition of S's row alone goes up (the matches among them); one reading the rows the
      // joins add holds here (a projection above may drop what it reads).
      const e = extension(r.src, S);
      if (!e) return null;
      const mine = e.rel ? made(e.rel) : new Set();
      const cs = conjuncts(subst(r.pred, e.row));
      const here = e.rel ? cs.filter(c => [...refsOf(c)].some(x => mine.has(x)) || existsIn(c)) : [];
      const up = cs.filter(c => !here.includes(c));
      return { ...e, rel: here.length ? P.select(e.rel, P.and(here)) : e.rel, conds: [...e.conds, ...up] };
    }
    case 'project': {
      const e = extension(r.src, S);
      if (!e) return null;
      const row = new Map(), items = [];
      for (const i of r.items) {
        if (i.expr.k === 'ref' && e.row.has(i.expr.col)) row.set(i.col, e.row.get(i.expr.col));
        else items.push({ col: i.col, expr: subst(i.expr, e.row) });
      }
      if (items.length && !e.rel) return null;
      return { rel: items.length ? P.projectAs(e.rel, items) : e.rel, conds: e.conds, row };
    }
    case 'apply': {
      if (r.outer) return null;
      const e = extension(r.left, S);
      if (!e) return null;
      const right = substRel(r.right, e.row);
      return { rel: e.rel ? P.apply(e.rel, right) : right, conds: e.conds, row: e.row };
    }
    case 'join': {
      if (r.kind !== 'inner' && r.kind !== 'cross') return null;
      const e = extension(r.left, S);
      if (!e) return null;
      const on = r.on && subst(r.on, e.row);
      const rel = e.rel ? P.join(r.kind, e.rel, r.right, on) : (on ? P.select(r.right, on) : r.right);
      return { rel, conds: e.conds, row: e.row };
    }
  }
  return null;
}
