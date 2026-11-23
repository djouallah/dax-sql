// Decorrelation: a query plan whose applies (a relation evaluated for each row of another) are
// joins and groupings, for every engine. General unnesting (Neumann & Kemper, "Unnesting
// Arbitrary Queries", 2015):
//
//   L ×ᴬ R(L.F)  =  L ⋈_{F ≡ F'} (D ⋈ᴬ R)     D = δ(π_F L): the distinct values R reads
//
// and D ⋈ᴬ R is pushed down R, operator by operator, until nothing in it reads D but D's own
// columns: σ and π carry D's columns, γ groups by them too (one over no rows becomes a left
// join from D, each value with its aggregate over none), a join takes D on the side that
// reads it (both: one each, matched), a union takes it in each branch, a window partitions
// by it. L and D are definitions, evaluated once. Where no rule applies, the rest stays an
// apply, over D only.
//
// First, an EXISTS a condition reads, correlated to a row, is an apply too: the row's count of
// the relation's rows, a blank when there is none.
import * as P from '../plan.js';

export function decorrelate(root) {
  const u = new Unnest();
  const defs = [];
  u.defs = defs;
  for (const d of root.defs ?? []) {
    d.rel = u.T(u.E(d.rel));
    defs.push(d);
  }
  const src = u.T(u.E(root.src));
  defs.forEach((d, i) => { d.n = i + 1; });
  return { ...root, src, defs };
}

const STUCK = Symbol('stuck');
// The aggregates whose value over no rows is a blank (as over a group's rows that the left join
// from D finds none of); those whose value over none is another.
const BLANK_OVER_NONE = new Set(['sum', 'avg', 'min', 'max', 'count', 'countrows', 'dcount', 'dcountnb', 'countblank', 'median',
  'stdev_s', 'stdev_p', 'var_s', 'var_p', 'single', 'onlyone', 'concat', 'pct_inc', 'pct_exc', 'pctx_inc', 'pctx_exc']);
const OVER_NONE = {
  count0: x => P.coalesce(x, { k: 'lit', v: 0, t: 'int', nn: true }),
  dcount0: x => P.coalesce(x, { k: 'lit', v: 0, t: 'int', nn: true }),
  hasone: x => P.coalesce(x, { k: 'lit', v: false, t: 'bool', nn: true }),
};

class Unnest {
  // A definition, before those that read it.
  define(rel) {
    const d = P.definition(rel, 0);
    this.defs.push(d);
    return d;
  }

  // --- EXISTS a row reads: an apply ---------------------------------------------------------

  E(r) {
    r = mapKids(r, k => this.E(k));
    // One in an inner join's condition: the condition over the rows the join's sides make.
    if (r.k === 'join' && r.kind !== 'left' && r.on && existsOf(r.on).some(e => free(e).size)) return this.E(P.select(P.join('cross', r.left, r.right), r.on));
    if (r.k === 'aggregate' || r.k === 'window') {
      const marks = [];
      const out = mapScalars(r, x => this.Ex(x, marks));
      if (!marks.length) return out;
      const src = marks.reduce((s, m) => P.apply(s, m), r.src);
      return r.k === 'window' ? { ...out, src, cols: [...src.cols, ...r.fns.map(f => f.col)] } : { ...out, src };
    }
    if (r.k !== 'select' && r.k !== 'project') return mapScalars(r, x => this.Ex(x, null));
    const marks = [];
    const conv = x => this.Ex(x, marks);
    const out = r.k === 'select' ? { ...r, pred: conv(r.pred) } : { ...r, items: r.items.map(i => ({ ...i, expr: conv(i.expr) })) };
    if (!marks.length) return r.k === 'select' ? belowApplies(out) : out;
    const src = marks.reduce((s, m) => P.apply(s, m), r.src);
    return r.k === 'select' ? belowApplies({ ...out, src, cols: src.cols }) : { ...out, src };
  }
  // A scalar's EXISTS: correlated, with `marks`, the count of an apply; the others' relations too.
  Ex(x, marks) {
    return mapScalar(x, y => {
      if (y.k !== 'exists') return null;
      const rel = this.E(y.rel);
      if (!marks || !free(rel).size) return { ...y, rel };
      const c = P.newCol('rows', 'int');
      marks.push(P.aggregate(rel, [], [{ col: c, fn: 'countrows', arg: null, extra: {} }]));
      return P.notNull(P.ref(c));
    });
  }

  // --- applies: joins ---------------------------------------------------------------------------

  T(r) {
    if (r.k === 'apply' && !r.stuck) return this.unnest(r);
    return mapScalars(mapKids(r, k => this.T(k)), x => mapScalar(x, y => (y.k === 'exists' ? { ...y, rel: this.T(y.rel) } : null)));
  }

  unnest(a) {
    const L = this.T(a.left);
    const fr = free(a.right);
    const F = L.cols.filter(c => fr.has(c));
    if (!F.length) {
      const R = this.T(a.right);
      return a.outer ? P.join('left', L, R, P.TRUE) : P.join('cross', L, R);
    }
    const eq = this.equiAgg(L, a.right, F);
    if (eq) return eq;
    // A range (a running total, a window of dates): R grouped first by what the range compares.
    const pre = preAggregate(a.right, F);
    if (pre) return this.unnest({ ...a, left: L, right: pre });
    // L reads a row around it: unnested with the apply around it.
    if (free(L).size) return P.apply(L, this.T(a.right), a.outer);
    const Ld = this.define(L);
    const sh = P.shared(Ld);
    let ctx;
    // L is the distinct values R reads: L is D.
    if (L.k === 'distinct' && L.cols.every(c => F.includes(c))) ctx = { D: Ld, F: L.cols };
    else {
      const forD = P.shared(Ld);
      ctx = { D: this.define(P.distinct(P.project(forD, F.map(f => ({ name: f.name, expr: P.ref(forD.cols[L.cols.indexOf(f)]), lineage: f.lineage, t: f.t }))))), F };
    }
    const { rel, dc } = this.push(a.right, ctx);
    const R = this.T(rel);
    const Lr = P.projectAs(sh, L.cols.map((c, i) => ({ col: c, expr: P.ref(sh.cols[i]) })));
    return P.join(a.outer ? 'left' : 'inner', Lr, R, P.and(ctx.F.map(f => P.key(P.ref(f), P.ref(dc.get(f))))));
  }

  // L ×ᴬ γ(σ_{inner ≡ outer ∧ rest} R), R and rest reading no F: each row's aggregate is that of
  // R's rows whose inner value is its outer one, so R is grouped by the inner values once and
  // joined to L on them (a row with none: the aggregates' values over no rows). Null when the
  // apply is not of that kind.
  equiAgg(L, g, F) {
    if (g.k !== 'aggregate' || g.keys.length || g.src.k !== 'select') return null;
    if (!g.aggs.every(a => BLANK_OVER_NONE.has(a.fn) || OVER_NONE[a.fn])) return null;
    const Fs = new Set(F);
    const reads = x => [...refsOf(x)].some(c => Fs.has(c)) || existsOf(x).some(r => [...free(r)].some(c => Fs.has(c)));
    const outerOnly = x => !existsOf(x).length && refsOf(x).size > 0 && [...refsOf(x)].every(c => Fs.has(c));
    if (g.aggs.some(a => [a.arg, a.extra?.delim, a.extra?.k, ...(a.extra?.order ?? []).map(o => o.expr)].some(x => x && reads(x)))) return null;
    const R = g.src.src;
    if ([...free(R)].some(c => Fs.has(c))) return null;
    const keys = [], rest = [];
    for (const c of conjuncts(g.src.pred)) {
      if (!reads(c)) { rest.push(c); continue; }
      const m = c.k === 'op' && c.op === 'eqs' ? 'eqs' : c.k === 'pop' && (c.op === 'eq' || c.op === 'key') ? c.op : null;
      if (!m) return null;
      const [a, b] = c.a;
      if (!reads(a) && outerOnly(b)) keys.push({ inner: a, outer: b, m });
      else if (!reads(b) && outerOnly(a)) keys.push({ inner: b, outer: a, m });
      else return null;
    }
    if (!keys.length) return null;
    const ks = keys.map(k => ({ col: P.newCol('key', k.inner.t), expr: k.inner }));
    const as = g.aggs.map(a => ({ ...a, col: P.newCol(a.col.name, a.col.t) }));
    const grouped = this.T(P.aggregate(rest.length ? P.select(R, P.and(rest)) : R, ks, as));
    const on = P.and(keys.map((k, i) => (k.m === 'eq' ? P.eq : P.key)(k.outer, P.ref(ks[i].col))));
    const j = P.join('left', L, grouped, on);
    const vals = g.aggs.map((a, i) => ({ col: a.col, expr: OVER_NONE[a.fn] ? OVER_NONE[a.fn](P.ref(as[i].col)) : P.ref(as[i].col) }));
    return P.projectAs(j, [...L.cols.map(c => ({ col: c, expr: P.ref(c) })), ...vals]);
  }

  // A use of D: { rel, dc: F's column -> its column there }.
  dref(ctx) {
    const s = P.shared(ctx.D);
    return { rel: s, dc: new Map(ctx.F.map((f, i) => [f, s.cols[i]])) };
  }

  // D ⋈ᴬ r: a relation of D's columns (dc) and r's (the same columns), reading no F.
  push(r, ctx) {
    const fr = free(r);
    if (!ctx.F.some(f => fr.has(f))) {
      const d = this.dref(ctx);
      return { rel: P.join('cross', d.rel, r), dc: d.dc };
    }
    try { return this.push1(r, ctx); } catch (e) {
      if (e !== STUCK) throw e;
      const d = this.dref(ctx);
      return { rel: { ...P.apply(d.rel, substRel(r, d.dc)), stuck: true }, dc: d.dc };
    }
  }

  // D ⋈ᴬ σ_{m ≠ BLANK ∧ rest}(l ×ᴬ γ_{m: COUNTROWS}(σ_{inner ≡ l.x ∧ more}(R))), l reading no D: a
  // semi-join of l's rows on equal values whose rows read D (a date in the window of the
  // group's month). D goes to the semi-join's side: R's rows counted by the inner values and
  // D's, joined to l on them, so l is not crossed with D. Null when r is not of that kind.
  markJoin(r, ctx) {
    const F = ctx.F, Fs = new Set(F);
    const a = r.src;
    if (a.k !== 'apply' || a.right.k !== 'aggregate' || a.right.keys.length || a.right.aggs.length !== 1) return null;
    const g = a.right, mark = g.aggs[0];
    if (mark.fn !== 'countrows' || g.src.k !== 'select') return null;
    const conj = conjuncts(r.pred);
    const test = conj.find(c => c.k === 'pop' && c.op === 'notnull' && c.a[0].k === 'ref' && c.a[0].col === mark.col);
    if (!test) return null;
    const l = a.left;
    if ([...free(l)].some(c => Fs.has(c))) return null;
    const Ls = new Set(l.cols), readsL = x => [...refsOf(x)].some(c => Ls.has(c)) || existsOf(x).some(e => [...free(e)].some(c => Ls.has(c)));
    const onlyL = x => !existsOf(x).length && refsOf(x).size > 0 && [...refsOf(x)].every(c => Ls.has(c));
    const R = g.src.src;
    if (readsL(R)) return null;
    const keys = [], more = [];
    for (const c of conjuncts(g.src.pred)) {
      if (!readsL(c)) { more.push(c); continue; }
      const m = c.k === 'op' && c.op === 'eqs' ? 'key' : c.k === 'pop' && (c.op === 'eq' || c.op === 'key') ? c.op : null;
      if (!m) return null;
      const [x, y] = c.a;
      if (!readsL(x) && onlyL(y)) keys.push({ inner: x, outer: y, m });
      else if (!readsL(y) && onlyL(x)) keys.push({ inner: y, outer: x, m });
      else return null;
    }
    if (!keys.length) return null;
    const ks = keys.map(k => ({ col: P.newCol('key', k.inner.t), expr: k.inner }));
    const counted = P.aggregate(more.length ? P.select(R, P.and(more)) : R, ks, [{ ...mark }]);
    const s = this.push(counted, ctx);
    const on = P.and(keys.map((k, i) => (k.m === 'eq' ? P.eq : P.key)(k.outer, P.ref(ks[i].col))));
    const rest = conj.filter(c => c !== test).map(c => subst(c, s.dc));
    const j = P.join('inner', l, s.rel, on);
    return { rel: rest.length ? P.select(j, P.and(rest)) : j, dc: s.dc };
  }

  push1(r, ctx) {
    const F = ctx.F;
    const S = (x, dc) => subst(x, dc);
    // D's columns, as new columns of a projection or a grouping over `dc`.
    const dItems = dc => F.map(f => ({ col: P.newCol(f.name, f.t, { lineage: f.lineage }), expr: P.ref(dc.get(f)) }));
    const asMap = items => new Map(F.map((f, i) => [f, items[i].col]));
    switch (r.k) {
      case 'select': {
        const m = this.markJoin(r, ctx);
        if (m) return m;
        const s = this.push(r.src, ctx);
        return { rel: P.select(s.rel, S(r.pred, s.dc)), dc: s.dc };
      }
      case 'project': {
        const s = this.push(r.src, ctx);
        const ds = dItems(s.dc);
        return { rel: P.projectAs(s.rel, [...r.items.map(i => ({ col: i.col, expr: S(i.expr, s.dc) })), ...ds]), dc: asMap(ds) };
      }
      case 'distinct': {
        if (r.src.k !== 'project') throw STUCK;
        const s = this.push(r.src, ctx);
        return { rel: P.distinct(s.rel), dc: s.dc };
      }
      case 'aggregate': {
        const s = this.push(r.src, ctx);
        const aggs = fresh => r.aggs.map(a => ({ ...a, col: fresh ? P.newCol(a.col.name, a.col.t) : a.col, arg: a.arg && S(a.arg, s.dc), extra: substExtra(a.extra, s.dc) }));
        const ds = dItems(s.dc);
        if (r.keys.length) {
          const g = P.aggregate(s.rel, [...r.keys.map(k => ({ col: k.col, expr: S(k.expr, s.dc) })), ...ds], aggs(false));
          return { rel: g, dc: asMap(ds) };
        }
        // Over no rows, each value of D has its aggregates' values over none.
        if (!r.aggs.every(a => BLANK_OVER_NONE.has(a.fn) || OVER_NONE[a.fn])) throw STUCK;
        const as = aggs(true);
        const g = P.aggregate(s.rel, ds, as);
        const d = this.dref(ctx);
        const j = P.join('left', d.rel, g, P.and(F.map((f, i) => P.key(P.ref(d.dc.get(f)), P.ref(ds[i].col)))));
        const out = dItems(d.dc);
        const vals = r.aggs.map((a, i) => ({ col: a.col, expr: OVER_NONE[a.fn] ? OVER_NONE[a.fn](P.ref(as[i].col)) : P.ref(as[i].col) }));
        return { rel: P.projectAs(j, [...vals, ...out]), dc: asMap(out) };
      }
      case 'join': {
        const has = rel => { const fr = free(rel); return F.some(f => fr.has(f)); };
        // The right side reads no D: D goes to the left, which the condition can read it on.
        if (!has(r.right)) {
          const s = this.push(r.left, ctx);
          return { rel: P.join(r.kind, s.rel, r.right, r.on && S(r.on, s.dc)), dc: s.dc };
        }
        if (!has(r.left) && r.kind !== 'left') {
          const s = this.push(r.right, ctx);
          return { rel: P.join(r.kind, r.left, s.rel, r.on && S(r.on, s.dc)), dc: s.dc };
        }
        // Both sides read D (or the right of a left join does): D on each, matched.
        const a = this.push(r.left, ctx), b = this.push(r.right, ctx);
        const match = F.map(f => P.key(P.ref(a.dc.get(f)), P.ref(b.dc.get(f))));
        const own = r.on ? [S(r.on, a.dc)] : [];
        return { rel: P.join(r.kind === 'cross' ? 'inner' : r.kind, a.rel, b.rel, P.and([...own, ...match])), dc: a.dc };
      }
      case 'apply': {
        // An apply inside: D goes to its left; its right reads D there (and is unnested next).
        const s = this.push(r.left, ctx);
        return { rel: P.apply(s.rel, substRel(r.right, s.dc), r.outer), dc: s.dc };
      }
      case 'union': {
        const out = F.map(f => P.newCol(f.name, f.t, { lineage: f.lineage }));
        const srcs = r.srcs.map((src, k) => {
          const s = this.push(src, ctx);
          return P.project(s.rel, [...r.picks[k].map(c => ({ name: c.name, expr: P.ref(c) })), ...F.map(f => ({ name: f.name, expr: P.ref(s.dc.get(f)) }))]);
        });
        return { rel: P.union(srcs, [...r.cols, ...out]), dc: new Map(F.map((f, i) => [f, out[i]])) };
      }
      case 'window': {
        const s = this.push(r.src, ctx);
        const fns = r.fns.map(f => ({ ...f, order: f.order.map(o => ({ ...o, expr: S(o.expr, s.dc) })) }));
        const part = [...r.part.map(p => S(p, s.dc)), ...F.map(f => P.ref(s.dc.get(f)))];
        return { rel: { ...r, src: s.rel, part, fns, cols: [...s.rel.cols, ...fns.map(f => f.col)] }, dc: s.dc };
      }
    }
    throw STUCK;
  }
}

// --- the columns a relation makes and reads ----------------------------------------------

const _made = new WeakMap(), _free = new WeakMap();

export function kids(r) {
  switch (r.k) {
    case 'select': case 'project': case 'distinct': case 'aggregate': case 'window': case 'output': return [r.src];
    case 'join': case 'apply': return [r.left, r.right];
    case 'union': return r.srcs;
    case 'series': return r.src ? [r.src] : [];
  }
  return [];
}

export function scalarsOf(r) {
  switch (r.k) {
    case 'select': return [r.pred];
    case 'project': return r.items.map(i => i.expr);
    case 'aggregate': return [...r.keys.map(k => k.expr), ...r.aggs.flatMap(a => [a.arg, a.extra?.delim, a.extra?.k, ...(a.extra?.order ?? []).map(o => o.expr)])].filter(Boolean);
    case 'join': return r.on ? [r.on] : [];
    case 'window': return [...r.part, ...r.fns.flatMap(f => f.order.map(o => o.expr))];
    case 'values': return r.rows.flat();
    case 'series': return [r.start, r.end, r.step];
    case 'output': return [...r.items.map(i => i.expr), ...r.order.map(o => o.expr)];
  }
  return [];
}

// Every column made in r's tree.
export function made(r) {
  let m = _made.get(r);
  if (!m) {
    m = new Set(r.cols);
    for (const k of kids(r)) for (const c of made(k)) m.add(c);
    _made.set(r, m);
  }
  return m;
}

// The columns r reads from outside its tree.
export function free(r) {
  let f = _free.get(r);
  if (f) return f;
  f = new Set();
  const mine = made(r);
  const add = c => { if (!mine.has(c)) f.add(c); };
  for (const k of kids(r)) free(k).forEach(add);
  for (const x of scalarsOf(r)) {
    refsOf(x).forEach(add);
    for (const rel of existsOf(x)) free(rel).forEach(add);
  }
  _free.set(r, f);
  return f;
}

function walk(x, f) {
  if (!x || typeof x !== 'object') return;
  f(x);
  if (x.k === 'op' || x.k === 'fn' || x.k === 'pop') x.a.forEach(y => walk(y, f));
  else if (x.k === 'case') { x.w.forEach(([c, v]) => { walk(c, f); walk(v, f); }); walk(x.e, f); }
}
function refsOf(x) {
  const out = new Set();
  walk(x, y => { if (y.k === 'ref') out.add(y.col); });
  return out;
}
function existsOf(x) {
  const out = [];
  walk(x, y => { if (y.k === 'exists') out.push(y.rel); });
  return out;
}

// --- rebuilding ----------------------------------------------------------------------------

// A scalar with `hook` applied top-down: its value replaces a node (null: go on inside).
function mapScalar(x, hook) {
  if (!x || typeof x !== 'object') return x;
  const h = hook(x);
  if (h) return h;
  if (x.k === 'op' || x.k === 'fn' || x.k === 'pop') return { ...x, a: x.a.map(y => mapScalar(y, hook)) };
  if (x.k === 'case') return { ...x, w: x.w.map(([c, v]) => [mapScalar(c, hook), mapScalar(v, hook)]), e: mapScalar(x.e, hook) };
  return x;
}

export function mapKids(r, g) {
  switch (r.k) {
    case 'select': case 'distinct': { const src = g(r.src); return { ...r, src, cols: src.cols }; }
    case 'project': case 'aggregate': case 'output': return { ...r, src: g(r.src) };
    case 'window': { const src = g(r.src); return { ...r, src, cols: [...src.cols, ...r.fns.map(f => f.col)] }; }
    case 'join': case 'apply': { const left = g(r.left), right = g(r.right); return { ...r, left, right, cols: [...left.cols, ...right.cols] }; }
    case 'union': return { ...r, srcs: r.srcs.map(g) };
    case 'series': return r.src ? { ...r, src: g(r.src) } : r;
  }
  return r;
}

export function mapScalars(r, f) {
  const S = x => (x ? f(x) : x);
  switch (r.k) {
    case 'select': return { ...r, pred: S(r.pred) };
    case 'project': return { ...r, items: r.items.map(i => ({ ...i, expr: S(i.expr) })) };
    case 'aggregate': return { ...r, keys: r.keys.map(k => ({ ...k, expr: S(k.expr) })), aggs: r.aggs.map(a => ({ ...a, arg: S(a.arg), extra: mapExtra(a.extra, S) })) };
    case 'join': return { ...r, on: S(r.on) };
    case 'window': return { ...r, part: r.part.map(S), fns: r.fns.map(fn => ({ ...fn, order: fn.order.map(o => ({ ...o, expr: S(o.expr) })) })) };
    case 'values': return { ...r, rows: r.rows.map(row => row.map(S)) };
    case 'series': return { ...r, start: S(r.start), end: S(r.end), step: S(r.step) };
    case 'output': return { ...r, items: r.items.map(i => ({ ...i, expr: S(i.expr) })), order: r.order.map(o => ({ ...o, expr: S(o.expr) })) };
  }
  return r;
}
const mapExtra = (e, S) => (e ? { ...e, ...(e.delim ? { delim: S(e.delim) } : {}), ...(e.k ? { k: S(e.k) } : {}), ...(e.order ? { order: e.order.map(o => ({ ...o, expr: S(o.expr) })) } : {}) } : e);

// A scalar reading the columns `map` names instead (an EXISTS' relation too).
function subst(x, map) {
  return mapScalar(x, y => {
    if (y.k === 'ref') return map.has(y.col) ? P.ref(map.get(y.col)) : y;
    if (y.k === 'exists') return { ...y, rel: substRel(y.rel, map) };
    return null;
  });
}
const substExtra = (e, map) => mapExtra(e, x => subst(x, map));
function substRel(r, map) {
  const fr = free(r);
  if (![...map.keys()].some(c => fr.has(c))) return r;
  return mapScalars(mapKids(r, k => substRel(k, map)), x => subst(x, map));
}

// The conditions a condition's ANDs hold.
export function conjuncts(x) {
  return (x.k === 'op' || x.k === 'pop') && x.op === 'and' ? x.a.flatMap(conjuncts) : [x];
}

// σ over applies: the conditions that read none of the applies' columns go below them, so the
// rows are filtered before each apply (and before a definition copies them).
function belowApplies(s) {
  if (s.k !== 'select' || s.src.k !== 'apply') return s;
  const chain = [];
  let x = s.src;
  while (x.k === 'apply') { chain.push(x); x = x.left; }
  // Only conditions on the rows' own columns: one that reads an outer row stays where the
  // decorrelation finds it (on top, matched as a key).
  const mine = made(x);
  const local = c => [...refsOf(c)].every(col => mine.has(col)) && existsOf(c).every(e => [...free(e)].every(col => mine.has(col)));
  const own = [], rest = [];
  for (const c of conjuncts(s.pred)) (local(c) ? own : rest).push(c);
  if (!own.length) return s;
  let base = P.select(x, P.and(own));
  for (const a of chain.reverse()) base = { ...P.apply(base, a.right, a.outer), stuck: a.stuck };
  return rest.length ? P.select(base, P.and(rest)) : base;
}

// γ(σ_{range ∧ rest} R), the range comparing columns of R with the outer row (F): R's rows
// grouped first by the columns the range reads, under rest, and the aggregate taken over those
// groups (sums added up, counts summed, the least and the greatest of theirs), so that what is
// matched with each outer row is a few groups, not every row. For SUM, MIN, MAX and COUNTROWS,
// by three columns at most; null otherwise.
const PARTIAL = { sum: 'sum', min: 'min', max: 'max', countrows: 'sum' };
function preAggregate(g, F) {
  if (g.k !== 'aggregate' || g.keys.length || g.src.k !== 'select' || g.pre) return null;
  if (!g.aggs.every(a => PARTIAL[a.fn] && !a.extra?.exact)) return null;
  const Fs = new Set(F), R = g.src.src, mine = made(R);
  const readsF = x => [...refsOf(x)].some(c => Fs.has(c)) || existsOf(x).some(r => [...free(r)].some(c => Fs.has(c)));
  if ([...free(R)].some(c => Fs.has(c)) || g.aggs.some(a => a.arg && readsF(a.arg))) return null;
  const range = [], rest = [];
  for (const c of conjuncts(g.src.pred)) (readsF(c) ? range : rest).push(c);
  if (!range.length || range.some(c => existsOf(c).length)) return null;
  const by = [...new Set(range.flatMap(c => [...refsOf(c)].filter(col => mine.has(col))))];
  if (!by.length || by.length > 3) return null;
  // The groups: by those columns, each aggregate over the group's rows.
  const keys = by.map(c => ({ col: P.newCol(c.name, c.t, { lineage: c.lineage, table: c.table }), expr: P.ref(c) }));
  const parts = g.aggs.map(a => ({ ...a, col: P.newCol(a.col.name, a.fn === 'countrows' ? 'int' : a.col.t) }));
  const groups = P.aggregate(rest.length ? P.select(R, P.and(rest)) : R, keys, parts);
  const map = new Map(by.map((c, i) => [c, keys[i].col]));
  const finals = g.aggs.map((a, i) => ({ col: a.col, fn: PARTIAL[a.fn], arg: P.ref(parts[i].col), extra: { t: parts[i].col.t } }));
  return { ...P.aggregate(P.select(groups, P.and(range.map(c => subst(c, map)))), [], finals), pre: true };
}
