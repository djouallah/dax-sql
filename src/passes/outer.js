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
    // The left joins below a filter (through projections, filters and inner joins) whose added
    // rows it drops.
    if (r.k === 'select') {
      const src = inner(r.src, r.pred);
      const sel = src === r.src ? r : { ...r, src, cols: src.cols };
      // Over an inner join (or one just made so): its condition (no EXISTS in it).
      if (sel.src.k === 'join' && sel.src.kind === 'inner' && !hasExists(sel.pred)) return uncross(P.join('inner', sel.src.left, sel.src.right, sel.src.on ? P.and([sel.src.on, sel.pred]) : sel.pred));
      return sel;
    }
    if (r.k === 'join' && r.kind === 'inner') return uncross(r);
    return r;
  };
  for (const d of root.defs ?? []) d.rel = O(d.rel);
  return { ...root, src: O(root.src) };
}

// r with the left joins whose added rows the condition `pred` over r's columns drops made inner.
function inner(r, pred) {
  switch (r.k) {
    case 'project': {
      const src = inner(r.src, put(pred, new Map(r.items.map(i => [i.col, i.expr]))));
      return src === r.src ? r : { ...r, src };
    }
    case 'select': {
      const src = inner(r.src, P.and([pred, r.pred]));
      return src === r.src ? r : { ...r, src, cols: src.cols };
    }
    case 'join': {
      const p = r.on ? P.and([pred, r.on]) : pred;
      // A left join that stays one keeps every row of its left: its condition filters none of them.
      if (r.kind === 'left' && !rejectsNull(pred, new Set(r.right.cols))) {
        const left = inner(r.left, pred);
        return left === r.left ? r : { ...r, left, cols: [...left.cols, ...r.right.cols] };
      }
      const left = inner(r.left, p), right = inner(r.right, p);
      if (r.kind !== 'left' && left === r.left && right === r.right) return r;
      return uncross(P.join(r.kind === 'left' ? 'inner' : r.kind, left, right, r.on));
    }
  }
  return r;
}

// (X × Y) ⋈ G on conditions between X and G and between Y and G -> (X ⋈ G) ⋈ Y (and G on
// the left, the same); again for what X is a cross join of.
function uncross(j) {
  if (j.k !== 'join' || j.kind !== 'inner' || !j.on) return j;
  // A condition's terms that read one side only, a cross join there: that cross join's condition
  // (an inner join filters its sides by them).
  for (const side of ['left', 'right']) {
    let c = j[side];
    // (A × B) ⟕ G on B's and G's columns only is A × (B ⟕ G): its columns in the same order.
    if (c.k === 'join' && c.kind === 'left' && c.left.k === 'join' && c.left.kind === 'cross' && c.on) {
      const A = new Set(c.left.left.cols);
      if (![...refs(c.on)].some(col => A.has(col))) c = P.join('cross', c.left.left, P.join('left', c.left.right, c.right, c.on));
    }
    // An inner join on this side: the terms that read its columns only, its condition too.
    if (c.k === 'join' && c.kind === 'inner') {
      const S = new Set(c.cols), cs = conjuncts(j.on);
      const mine = cs.filter(t => { const f = refs(t); return f.size > 0 && !hasExists(t) && [...f].every(col => S.has(col)); });
      if (!mine.length) continue;
      const rest = cs.filter(t => !mine.includes(t));
      const below = uncross(P.join('inner', c.left, c.right, P.and([...conjuncts(c.on), ...mine])));
      const on = rest.length ? P.and(rest) : P.TRUE;
      return uncross(side === 'left' ? P.join('inner', below, j.right, on) : P.join('inner', j.left, below, on));
    }
    if (c.k !== 'join' || c.kind !== 'cross') continue;
    const S = new Set(c.cols), O = new Set(c.left.cols), Q = new Set(c.right.cols);
    const cs = conjuncts(j.on);
    const mine = cs.filter(t => { const f = refs(t); return f.size > 0 && [...f].every(col => S.has(col)) && [...f].some(col => O.has(col)) && [...f].some(col => Q.has(col)); });
    if (!mine.length) continue;
    const rest = cs.filter(t => !mine.includes(t));
    const inner = uncross(P.join('inner', c.left, c.right, P.and(mine)));
    const out = side === 'left' ? P.join('inner', inner, j.right, rest.length ? P.and(rest) : P.TRUE) : P.join('inner', j.left, inner, rest.length ? P.and(rest) : P.TRUE);
    return uncross(out);
  }
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

// Whether a condition is false or unknown when the columns `nulls` are all NULL (the rows a left
// join adds): the condition evaluated with them NULL, three-valued.
function rejectsNull(x, nulls) {
  if (x.k === 'pop' && x.op === 'and') return x.a.some(y => rejectsNull(y, nulls));
  if (x.k === 'pop' && x.op === 'or') return x.a.every(y => rejectsNull(y, nulls));
  const v = ev(x, nulls);
  return v === null || v === false;
}

// Functions NULL when an argument is (SQL's strict ones).
const STRICT = new Set(['round', 'abs', 'sign', 'floor', 'ceil', 'trunc', 'power', 'mod', 'idiv', 'log10', 'upper', 'lower',
  'length', 'substring', 'substring_from', 'left', 'right', 'trim', 'replace', 'strpos', 'add_days', 'add_months', 'add_microseconds',
  'date_diff_day', 'date_diff_month', 'date_diff_microsecond', 'date_trunc_year', 'date_trunc_quarter', 'date_trunc_month',
  'extract_year', 'extract_quarter', 'extract_month', 'extract_day', 'extract_hour', 'extract_minute', 'extract_second', 'extract_dow']);
const ARITH = { add: (a, b) => a + b, sub: (a, b) => a - b, mul: (a, b) => a * b, div: (a, b) => (b === 0 ? undefined : a / b) };
const CMP = { eq: (a, b) => a === b, ne: (a, b) => a !== b, lt: (a, b) => a < b, le: (a, b) => a <= b, gt: (a, b) => a > b, ge: (a, b) => a >= b };
// A scalar's value with the columns `nulls` NULL: null, a constant, or undefined (not known).
function ev(x, nulls) {
  if (!x || typeof x !== 'object') return undefined;
  if (x.k === 'lit') return x.v;
  if (x.k === 'ref') return nulls.has(x.col) ? null : undefined;
  // CASE: the branch taken; where a condition is not known, NULL when every branch it could take is.
  if (x.k === 'case') {
    const could = [];
    for (const [c, v] of x.w) {
      const t = ev(c, nulls);
      if (t === true) { could.push(ev(v, nulls)); return could.every(u => u === null) ? null : could.length === 1 ? could[0] : undefined; }
      if (t === undefined) could.push(ev(v, nulls));
    }
    could.push(ev(x.e, nulls));
    return could.every(u => u === null) ? null : could.length === 1 ? could[0] : undefined;
  }
  if (x.k !== 'pop') return undefined;
  const A = () => x.a.map(y => ev(y, nulls));
  switch (x.op) {
    case 'true': return true;
    case 'false': return false;
    case 'notnull': { const v = ev(x.a[0], nulls); return v === undefined ? undefined : v !== null; }
    case 'isnull': { const v = ev(x.a[0], nulls); return v === undefined ? undefined : v === null; }
    case 'not': { const v = ev(x.a[0], nulls); return v === null || v === undefined ? v : !v; }
    case 'and': { const v = A(); if (v.some(t => t === false)) return false; if (v.some(t => t === undefined)) return undefined; return v.some(t => t === null) ? null : true; }
    case 'or': { const v = A(); if (v.some(t => t === true)) return true; if (v.some(t => t === undefined)) return undefined; return v.some(t => t === null) ? null : false; }
    case 'coalesce': { for (const y of x.a) { const v = ev(y, nulls); if (v === undefined) return undefined; if (v !== null) return v; } return null; }
    // NULLIF(a, b): NULL when a is, or when both are known and equal (NULLIF(COALESCE(count, 0), 0)
    // of a row a left join adds: a count over no rows, a blank).
    case 'nullif': {
      const [a, b] = A();
      if (a === null) return null;
      if (a === undefined || b === undefined) return undefined;
      return b !== null && a === b ? null : a;
    }
    case 'cast': case 'neg': { const v = ev(x.a[0], nulls); return v === null ? null : v === undefined ? undefined : x.op === 'neg' ? -v : v; }
    case 'call': { if (!STRICT.has(x.name)) return undefined; return A().some(v => v === null) ? null : undefined; }
    case 'in': { const v = ev(x.a[0], nulls); return v === null ? null : undefined; }
  }
  if (ARITH[x.op] || CMP[x.op]) {
    const v = A();
    if (v.some(t => t === null)) return null;
    if (v.some(t => t === undefined || typeof t !== 'number' && typeof t !== 'string')) return undefined;
    return (ARITH[x.op] ?? CMP[x.op])(v[0], v[1]);
  }
  return undefined;
}
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
function hasExists(x) {
  if (!x || typeof x !== 'object') return false;
  if (x.k === 'exists') return true;
  if (x.k === 'case') return x.w.some(([c, v]) => hasExists(c) || hasExists(v)) || hasExists(x.e);
  return Array.isArray(x.a) && x.a.some(hasExists);
}
