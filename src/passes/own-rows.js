// A scan matched on all its columns to rows of its own table that joins extended: the rows of
// the scan whose own extension holds the condition (grid-0049: the SQL front end's TREATAS of all
// 16 columns of catalog_sales from the rows of catalog_sales ⋈ promotion ⋈ item, a DISTINCT of
// 14 M rows and a join on 16 columns, for SUM over the join the hand writes; 4.9 s to 0.4 s at SF10).
//
//   σ ∃(σ (S'.c ≡ S.c, every c) ∧ p (S' ⋈ T…)) (S)   =   σ own(S) ⋈ δ π k σ rest(T…) on x = k
//
// S and S' scans of the same table, every stored column. Two rows alike in every column have
// the same extensions (the joins and conditions read the same values), so a row of S matches a
// row of S' ⋈ T… holding p exactly when one of its own extensions holds p: no key need be
// unique. Of p, what reads S's row alone (own) holds on S; the first join's matches of S's values
// x to T…'s k are the semi join's keys; the rest reads T… alone. What is between the EXISTS and
// S' must be row-wise: σ, π, an inner apply or join to other rows, a definition's read. A join,
// not the EXISTS of S's own extension: DuckDB does not unnest that one under a group's apply
// (8d84576, past 120 s at SF1); and not every column (the semijoins pass's): a DISTINCT of the fact.
import * as P from '../plan.js';
import { mapKids, mapScalars, subst, conjuncts, made, refsOf, existsOf, free } from './decorrelate.js';
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
  const parts = conjuncts(r.pred);
  for (const [i, c] of parts.entries()) {
    if (c.k !== 'exists') continue;
    const x = ownJoin(c.rel, S);
    if (!x) continue;
    // S's own conditions (the others of the σ, and the EXISTS' of S's row alone) on S, then the
    // semi join: S's rows whose keys some row of T… holding the rest has (each once: δ).
    const own = [...parts.slice(0, i), ...parts.slice(i + 1), ...x.own];
    const left = own.length ? P.select(S, P.and(own)) : S;
    if (!x.keys.length) return x.rel ? P.select(left, P.exists(x.rel)) : left;
    const ks = x.keys.map(k => k.col);
    const d = P.distinct(P.projectAs(x.rel, ks.map(col => ({ col, expr: P.ref(col) }))));
    const j = P.join('inner', left, d, P.and(x.keys.map(k => k.op(k.s, P.ref(k.col)))));
    return P.projectAs(j, S.cols.map(col => ({ col, expr: P.ref(col) })));
  }
  return null;
}

// An EXISTS of S' ⋈ T… matched to S's row on every column: { own, keys, rel }, own the
// conditions of S's row alone, keys the matches of S's values to T…'s (the first join's: each
// { s, col, op }), rel the rows of T… holding the rest (none reading S). Null when it is not.
function ownJoin(rel, S) {
  const ext = extension(rel, S);
  if (!ext) return null;
  const matched = new Set(), own = [], rest = [];
  const reads = c => [...refsOf(c)].some(x => S.cols.includes(x)) || existsOf(c).some(e => [...free(e)].some(x => S.cols.includes(x)));
  for (const c of ext.conds.flatMap(conjuncts)) {
    if (isMatch(c) && c.a[0].k === 'ref' && c.a[1].k === 'ref' && c.a[0].col === c.a[1].col && S.cols.includes(c.a[0].col)) matched.add(c.a[0].col);
    else (reads(c) ? own : rest).push(c);
  }
  if (!S.cols.every(c => matched.has(c))) return null;
  // What T… holds may read S's row only through the keys.
  if (ext.rel && [...free(ext.rel)].some(x => S.cols.includes(x))) return null;
  if (rest.length && !ext.rel) return null;
  if (own.some(c => [...refsOf(c)].some(x => ext.rel && made(ext.rel).has(x)))) return null;
  return { own, keys: ext.keys ?? [], rel: ext.rel && rest.length ? P.select(ext.rel, P.and(rest)) : ext.rel };
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
      return { ...e, rel: items.length ? P.projectAs(e.rel, [...items, ...(e.keys ?? []).map(k => ({ col: k.col, expr: P.ref(k.col) }))]) : e.rel, row };
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
      return { ...e, rel: items.length ? P.projectAs(e.rel, [...items, ...(e.keys ?? []).map(k => ({ col: k.col, expr: P.ref(k.col) }))]) : e.rel, row };
    }
    case 'apply': {
      if (r.outer) return null;
      const e = extension(r.left, S);
      if (!e) return null;
      const right = substRel(r.right, e.row);
      if (e.rel) return { ...e, rel: P.apply(e.rel, right) };
      const k = keyed(right, S);
      return k && { ...e, rel: k.rel, keys: k.keys };
    }
    case 'join': {
      if (r.kind !== 'inner' && r.kind !== 'cross') return null;
      const e = extension(r.left, S);
      if (!e) return null;
      const on = r.on && subst(r.on, e.row);
      if (e.rel) return { ...e, rel: P.join(r.kind, e.rel, r.right, on) };
      const k = keyed(on ? P.select(r.right, on) : r.right, S);
      return k && { ...e, rel: k.rel, keys: k.keys };
    }
  }
  return null;
}

// The rows the first join adds to S's row, σc(R): c's matches of a value of S's row alone to one of
// R's alone (= or ≡) as keys, each R's value a column of its own; the rest of c reading none of S.
function keyed(right, S) {
  const ofS = x => { const rs = refsOf(x); return rs.size > 0 && [...rs].every(c => S.cols.includes(c)) && !existsOf(x).length; };
  const none = x => ![...refsOf(x)].some(c => S.cols.includes(c)) && !existsOf(x).some(e => [...free(e)].some(c => S.cols.includes(c)));
  let src = right, cs = [];
  if (right.k === 'select') { src = right.src; cs = conjuncts(right.pred); }
  if ([...free(src)].some(c => S.cols.includes(c))) return null;
  const keys = [], items = [], rest = [];
  for (const c of cs) {
    const eqOp = (c.k === 'op' || c.k === 'pop') && (c.op === 'eq' || c.op === 'eqs' || c.op === 'key') && c.a.length === 2;
    const [l, rr] = eqOp ? c.a : [];
    const side = eqOp && ofS(l) && none(rr) ? [l, rr] : eqOp && ofS(rr) && none(l) ? [rr, l] : null;
    if (side) {
      const col = P.newCol('k', side[1].t);
      items.push({ col, expr: side[1] });
      keys.push({ s: side[0], col, op: (x, y) => ({ ...c, a: [x, y] }) });
    } else if (none(c)) rest.push(c);
    else return null;
  }
  const base = rest.length ? P.select(src, P.and(rest)) : src;
  return { rel: keys.length ? P.projectAs(base, [...base.cols.map(col => ({ col, expr: P.ref(col) })), ...items]) : base, keys };
}
