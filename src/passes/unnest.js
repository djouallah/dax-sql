// Unnesting, top down: the correlated plan (the plan DuckDB is given, its measures fused, its
// scalars standard) with every apply a join and every correlated EXISTS a count, for an engine
// that does not unnest (Neumann, "Improving Unnesting of Complex Queries", BTW 2025; the
// decorrelation of the optimizer's own pass, decorrelate.js, is bottom up and stays as it is).
//
//   L ×ᴬ R(F)  =  L ⋈_{F ≡ F'} R'        R' = R with each read of F a column F' of its own rows
//
// R' is R pushed down, operator by operator, from the top: a condition F = x binds F to the
// rows' own x (F' is x: no D at all); where nothing binds F, the rows take it from D = δ(π_F L),
// the distinct values of F, joined in at the operator that reads it. R' holds, for each value v
// of F that L has, R's rows for v under F' (and maybe rows for values L has not, which the join
// to L drops). A grouping of no key (one row for each v, over rows or none) is grouped by F' and
// left-joined from L (or from D, inside): over no rows, a count 0, any other aggregate a blank.
// An apply inside R (a measure of a row of a row) is pushed into its left and unnested there,
// its D carrying the columns of every level above: an apply is unnested once, from the top, and
// no apply is left.
import * as P from '../plan.js';
import { mapKids, mapScalars, subst, refsOf, conjuncts, free } from './decorrelate.js';
import { clone } from './clone.js';

export function unnest(root) {
  const u = new Unnest();
  // Each definition after those it reads (the rows D is made of are one, made as it goes).
  const defs = u.defs = [];
  for (const d of root.defs ?? []) { d.rel = u.U(marks(d.rel)); defs.push(d); }
  const src = u.U(marks(root.src));
  const out = mapScalars({ ...root, src, defs }, x => u.Ux(x));
  defs.forEach((d, i) => { d.n = i + 1; });
  return out;
}

// An AND of none: TRUE.
const AND = xs => (xs.length ? P.and(xs) : P.TRUE);
const ZERO = { k: 'lit', v: 0, t: 'int', nn: true };
// An aggregate's value over no rows: SQL's (a count 0, any other a blank).
const COUNTS = new Set(['count_star', 'count_values', 'count_distinct']);
const overNone = (fn, x) => (COUNTS.has(fn) ? P.coalesce(x, ZERO) : x);

// --- correlated EXISTS: a count ------------------------------------------------------------

// EXISTS(R) of a row (R reading the row, or a row around it): the count of R's rows for the
// row, an apply of one row, and the condition count > 0.
function marks(r) {
  r = mapKids(r, marks);
  if (!scalarsOf1(r).some(x => existsOf(x).some(e => free(e).size))) return mapScalars(r, x => markRels(x));
  if (r.k === 'join' && r.kind !== 'left') return marks(P.select(P.join('cross', r.left, r.right), r.on));
  const ms = [];
  const conv = x => toMarks(x, ms);
  switch (r.k) {
    case 'select': {
      // The conditions with no EXISTS are tested first, below the counts.
      const own = [], rest = [];
      for (const c of conjuncts(r.pred)) (existsOf(c).some(e => free(e).size) ? rest : own).push(c);
      const below = own.length ? P.select(r.src, P.and(own)) : r.src;
      const pred = conv(P.and(rest));
      const src = ms.reduce((s, m) => P.apply(s, m), below);
      return P.select(src, pred);
    }
    case 'project': case 'aggregate': {
      const out = mapScalars(r, conv);
      return { ...out, src: ms.reduce((s, m) => P.apply(s, m), r.src) };
    }
    case 'window': {
      const out = mapScalars(r, conv);
      const src = ms.reduce((s, m) => P.apply(s, m), r.src);
      return { ...out, src, cols: [...src.cols, ...r.fns.map(f => f.col)] };
    }
    case 'join': {
      // A left join's condition: a count of the right's rows, when it reads only them.
      const mine = new Set(r.left.cols);
      const ok = existsOf(r.on).every(e => ![...free(e)].some(c => mine.has(c)));
      if (!ok) throw new Error('unnest: an EXISTS of a left join\'s two sides');
      const on = conv(r.on);
      return { ...r, on, right: ms.reduce((s, m) => P.apply(s, m), r.right), cols: [...r.left.cols, ...r.right.cols, ...ms.flatMap(m => m.cols)] };
    }
  }
  throw new Error(`unnest: a correlated EXISTS in ${r.k}`);
}
function toMarks(x, ms) {
  return mapScalar(x, y => {
    if (y.k !== 'exists') return null;
    const rel = marks(y.rel);
    if (!free(rel).size) return { ...y, rel };
    const c = P.newCol('rows', 'int', { nn: true });
    ms.push(P.aggregate(rel, [], [{ col: c, fn: 'count_star', arg: null, extra: {} }]));
    return P.cmp('gt', P.ref(c), ZERO);
  });
}
// Uncorrelated EXISTS: their relations' own EXISTS.
const markRels = x => mapScalar(x, y => (y.k === 'exists' ? { ...y, rel: marks(y.rel) } : null));

// --- applies: joins ------------------------------------------------------------------------

class Unnest {
  constructor() { this.memo = new Map(); }

  // A relation reading nothing from outside, its applies unnested (once: one read twice is the
  // same one unnested).
  U(r) {
    if (this.memo.has(r)) return this.memo.get(r);
    const out = r.k === 'apply' ? this.apply(r) : mapScalars(mapKids(r, k => this.U(k)), x => this.Ux(x));
    this.memo.set(r, out);
    return out;
  }
  // A scalar's EXISTS (none correlated): their relations unnested.
  Ux(x) { return mapScalar(x, y => (y.k === 'exists' ? { ...y, rel: this.U(y.rel) } : null)); }
  // A scalar of R' (F read as F'), its EXISTS unnested.
  S(x, dc) { return x && this.Ux(subst(x, dc)); }

  apply(a) {
    const L = this.U(a.left);
    const fr = free(a.right);
    const F = L.cols.filter(c => fr.has(c));
    if (F.length < fr.size) throw new Error('unnest: an apply reading a row from outside it');
    if (!F.length) {
      const R = this.U(a.right);
      return a.outer ? P.join('left', L, R, P.TRUE) : P.join('cross', L, R);
    }
    // D's rows: the relation inside L that has L's values of F (below the measures of each row,
    // left-joined to it), not L: the same values, fewer rows, and no read of the levels below.
    const dom = domain(L, F);
    const ctx = { F, L, src: dom.rel, at: dom.map };
    const top = this.oneRowTop(a.right, ctx);
    if (top) return top;
    const s = this.push(a.right, ctx);
    return P.join(a.outer ? 'left' : 'inner', this.Lof(ctx), s.rel, this.match(F, s));
  }

  // L as the join reads it: when D was made of L, L's definition, read under L's columns.
  Lof(ctx) {
    if (!ctx.def || ctx.src !== ctx.L) return ctx.L;
    const s = P.shared(ctx.def);
    return P.projectAs(s, ctx.L.cols.map((c, i) => ({ col: c, expr: P.ref(s.cols[i]) })));
  }

  // L ⋈ R' on F ≡ F' (= for F' an x bound by =).
  match(F, s) {
    return AND(F.filter(f => s.dc.has(f)).map(f => (s.op.get(f) === 'eq' ? P.eq : P.key)(P.ref(f), P.ref(s.dc.get(f)))));
  }

  // L ×ᴬ π…(γ aggs(R)), a grouping of no key (a measure of L's row): R' grouped by F', left-
  // joined from L, each aggregate over no rows its value over none, the projections over the
  // join (they read L's row as it is). Null when the apply is not of that kind.
  oneRowTop(right, ctx) {
    const chain = [];
    let g = right;
    while (g.k === 'project') { chain.push(g); g = g.src; }
    if (g.k !== 'aggregate' || g.keys.length) return null;
    const { rel, keys, as, s } = this.grouped(g, ctx);
    const L = this.Lof(ctx);
    let out = P.join('left', L, rel, AND(ctx.F.filter(f => s.dc.has(f)).map((f, i) => (s.op.get(f) === 'eq' ? P.eq : P.key)(P.ref(f), P.ref(keys.get(f))))));
    const keep = () => L.cols.map(c => ({ col: c, expr: P.ref(c) }));
    out = P.projectAs(out, [...keep(), ...g.aggs.map((x, i) => ({ col: x.col, expr: overNone(x.fn, P.ref(as[i].col)) }))]);
    for (const p of chain.reverse()) out = P.projectAs(out, [...keep(), ...p.items.map(i => ({ col: i.col, expr: this.Ux(i.expr) }))]);
    return out;
  }

  // γ(R) of no key, R' grouped by F': { rel, keys: F -> its key column, as: the aggregates
  // (columns of their own), s }.
  grouped(g, ctx) {
    let s = this.push(g.src, ctx);
    s = this.need(s, this.reads(g.aggs.flatMap(aggScalars), ctx, s), ctx);
    const F = ctx.F.filter(f => s.dc.has(f));
    const ks = F.map(f => ({ col: P.newCol(f.name, f.t, { lineage: f.lineage }), expr: P.ref(s.dc.get(f)) }));
    const as = g.aggs.map(x => ({ ...x, col: P.newCol(x.col.name, x.col.t), arg: this.S(x.arg, s.dc), extra: mapExtra(x.extra, y => this.S(y, s.dc)) }));
    return { rel: P.aggregate(s.rel, ks, as), keys: new Map(F.map((f, i) => [f, ks[i].col])), as, s };
  }

  // The columns of F the scalars read that s has no F' for.
  reads(xs, ctx, s) {
    const fs = new Set();
    for (const x of xs) {
      if (!x) continue;
      for (const c of refsOf(x)) fs.add(c);
      for (const e of existsOf(x)) for (const c of free(e)) fs.add(c);
    }
    return ctx.F.filter(f => fs.has(f) && !s.dc.has(f));
  }

  // D's values of `cols` (with those of F s has, matched to them) joined to s's rows, on `cond`
  // too (a condition reading them: a range): s with F' for cols.
  need(s, cols, ctx, cond = null) {
    if (!cols.length) return cond ? { ...s, rel: P.select(s.rel, cond) } : s;
    const have = ctx.F.filter(f => s.dc.has(f));
    const d = this.D(ctx, [...have, ...cols]);
    const dc = new Map(s.dc), op = new Map(s.op);
    for (const f of cols) { dc.set(f, d.at.get(f)); op.set(f, 'key'); }
    const on = [...have.map(f => (s.op.get(f) === 'eq' ? P.eq : P.key)(P.ref(d.at.get(f)), P.ref(s.dc.get(f)))), ...(cond ? [subst(cond, dc)] : [])];
    return { rel: on.length ? P.join('inner', d.rel, s.rel, P.and(on)) : P.join('cross', d.rel, s.rel), dc, op };
  }

  // δ(π_cols L): L (or the relation inside it with L's values of F) a definition, made at the
  // first D, each D a read of it under columns of its own (a column is one relation's: L is read
  // at the top too).
  D(ctx, cols) {
    if (!ctx.def) {
      // A relation inside L's tree: the definition a copy of it.
      const c = ctx.src === ctx.L ? { rel: ctx.L, map: new Map() } : clone(ctx.src);
      ctx.def = P.definition(c.rel, 0);
      ctx.map = c.map;
      this.defs.push(ctx.def);
    }
    const sh = P.shared(ctx.def);
    const at = f => { const c = ctx.at.get(f); return sh.cols[ctx.def.rel.cols.indexOf(ctx.map.get(c) ?? c)]; };
    const p = P.project(sh, cols.map(f => ({ name: f.name, expr: P.ref(at(f)), lineage: f.lineage, t: f.t })));
    const rel = P.distinct(p);
    return { rel, at: new Map(cols.map((f, i) => [f, rel.cols[i]])) };
  }

  // R' for r: { rel, dc: F -> F' (the columns of F r reads), op: F -> 'eq' (F' an x bound by =:
  // a blank F has no rows) or 'key' }.
  push(r, ctx) {
    const fr = free(r);
    if (!ctx.F.some(f => fr.has(f))) return { rel: this.U(r), dc: new Map(), op: new Map() };
    switch (r.k) {
      case 'select': {
        const s = this.push(r.src, ctx);
        let rel = s.rel;
        const dc = new Map(s.dc), op = new Map(s.op);
        const cs = conjuncts(r.pred).map(c => subst(c, s.dc));
        const rest = [];
        // F = x, x of the rows' own: F' is x.
        for (const c of cs) {
          const b = bind(c, ctx.F, dc);
          if (!b) { rest.push(c); continue; }
          let col = b.x.k === 'ref' ? b.x.col : null;
          if (!col) {
            col = P.newCol(b.f.name, b.x.t ?? b.f.t, { lineage: b.f.lineage });
            rel = P.projectAs(rel, [...rel.cols.map(c2 => ({ col: c2, expr: P.ref(c2) })), { col, expr: this.Ux(b.x) }]);
          }
          dc.set(b.f, col);
          op.set(b.f, b.m);
        }
        const conds = rest.map(c => this.S(c, dc));
        const t = { rel, dc, op };
        const missing = this.reads(conds, ctx, t);
        if (missing.length) return this.need(t, missing, ctx, P.and(conds));
        return conds.length ? { ...t, rel: P.select(rel, P.and(conds)) } : t;
      }
      case 'project': {
        let s = this.push(r.src, ctx);
        s = this.need(s, this.reads(r.items.map(i => i.expr), ctx, s), ctx);
        const ds = this.carry(s, ctx);
        return { rel: P.projectAs(s.rel, [...r.items.map(i => ({ col: i.col, expr: this.S(i.expr, s.dc) })), ...ds.items]), dc: ds.dc, op: s.op };
      }
      case 'distinct': {
        const s = this.push(r.src, ctx);
        return { ...s, rel: P.distinct(s.rel) };
      }
      case 'aggregate': {
        if (r.keys.length) {
          let s = this.push(r.src, ctx);
          s = this.need(s, this.reads([...r.keys.map(k => k.expr), ...r.aggs.flatMap(aggScalars)], ctx, s), ctx);
          const ds = this.carry(s, ctx);
          const keys = [...r.keys.map(k => ({ col: k.col, expr: this.S(k.expr, s.dc) })), ...ds.items];
          const aggs = r.aggs.map(x => ({ ...x, arg: this.S(x.arg, s.dc), extra: mapExtra(x.extra, y => this.S(y, s.dc)) }));
          return { rel: P.aggregate(s.rel, keys, aggs), dc: ds.dc, op: s.op };
        }
        // One row for each value of D: D left-joined to R' grouped by F'.
        const { rel, keys, as, s } = this.grouped(r, ctx);
        const F = ctx.F.filter(f => s.dc.has(f));
        const d = this.D(ctx, F);
        const j = P.join('left', d.rel, rel, AND(F.map(f => (s.op.get(f) === 'eq' ? P.eq : P.key)(P.ref(d.at.get(f)), P.ref(keys.get(f))))));
        const dcs = F.map(f => ({ col: P.newCol(f.name, f.t, { lineage: f.lineage }), expr: P.ref(d.at.get(f)) }));
        const vals = r.aggs.map((x, i) => ({ col: x.col, expr: overNone(x.fn, P.ref(as[i].col)) }));
        return { rel: P.projectAs(j, [...vals, ...dcs]), dc: new Map(F.map((f, i) => [f, dcs[i].col])), op: new Map(F.map(f => [f, 'key'])) };
      }
      case 'join': {
        const has = x => { const f = free(x); return ctx.F.some(c => f.has(c)); };
        if (!has(r.right) || (!has(r.left) && r.kind !== 'left')) {
          // One side reads F: R' of it, the other as it is; the condition reads F' (F from D on
          // the side R' is, when that side has none: a left join's left).
          const left = !has(r.right);
          let s = this.push(left ? r.left : r.right, ctx);
          const other = this.U(left ? r.right : r.left);
          s = this.need(s, this.reads([r.on], ctx, s), ctx);
          const on = r.on && this.S(r.on, s.dc);
          return { ...s, rel: left ? P.join(r.kind, s.rel, other, on) : P.join(r.kind, other, s.rel, on) };
        }
        // Both (or the right of a left join): R' of each, the left with every F' the right has,
        // matched.
        let b = this.push(r.right, ctx);
        let a = this.push(r.left, ctx);
        a = this.need(a, ctx.F.filter(f => b.dc.has(f) && !a.dc.has(f)), ctx);
        a = this.need(a, this.reads([r.on], ctx, { dc: new Map([...b.dc, ...a.dc]) }), ctx);
        const dc = new Map([...b.dc, ...a.dc]), op = new Map([...b.op, ...a.op]);
        const eqs = [];
        for (const f of ctx.F) {
          if (!a.dc.has(f) || !b.dc.has(f)) continue;
          const m = a.op.get(f) === 'eq' || b.op.get(f) === 'eq' ? 'eq' : 'key';
          op.set(f, m);
          eqs.push((m === 'eq' ? P.eq : P.key)(P.ref(a.dc.get(f)), P.ref(b.dc.get(f))));
        }
        const own = r.on ? [this.S(r.on, dc)] : [];
        return { rel: P.join(r.kind === 'cross' ? 'inner' : r.kind, a.rel, b.rel, AND([...own, ...eqs])), dc, op };
      }
      case 'apply': {
        // An apply inside: F' in its left, its right reading F' there, unnested at its own level
        // (its D: the values of the columns its right reads, F' among them).
        let s = this.push(r.left, ctx);
        s = this.need(s, ctx.F.filter(f => free(r.right).has(f) && !s.dc.has(f)), ctx);
        return { ...s, rel: this.U(P.apply(s.rel, substRel(r.right, s.dc), r.outer)) };
      }
      case 'union': {
        const ss = r.srcs.map(x => this.push(x, ctx));
        const F = ctx.F.filter(f => ss.some(s => s.dc.has(f)));
        let full = ss.map(s => this.need(s, F.filter(f => !s.dc.has(f)), ctx));
        // Each branch's F' matched the same way: a blank x bound by = has no rows.
        if (F.some(f => new Set(full.map(s => s.op.get(f))).size > 1)) {
          full = full.map(s => {
            const nn = F.filter(f => s.op.get(f) === 'eq').map(f => P.notNull(P.ref(s.dc.get(f))));
            return { rel: nn.length ? P.select(s.rel, P.and(nn)) : s.rel, dc: s.dc, op: new Map(F.map(f => [f, 'key'])) };
          });
        }
        const srcs = full.map((s, k) => P.project(s.rel, [...r.picks[k].map(c => ({ name: c.name, expr: P.ref(c) })), ...F.map(f => ({ name: f.name, expr: P.ref(s.dc.get(f)) }))]));
        const u = P.union(srcs, [...r.cols, ...F.map(f => P.newCol(f.name, f.t, { lineage: f.lineage }))]);
        return { rel: u, dc: new Map(F.map((f, i) => [f, u.cols[r.cols.length + i]])), op: full[0].op };
      }
      case 'window': {
        let s = this.push(r.src, ctx);
        s = this.need(s, this.reads([...r.part, ...r.fns.flatMap(f => f.order.map(o => o.expr))], ctx, s), ctx);
        const F = ctx.F.filter(f => s.dc.has(f));
        const fns = r.fns.map(f => ({ ...f, order: f.order.map(o => ({ ...o, expr: this.S(o.expr, s.dc) })) }));
        const part = [...r.part.map(p => this.S(p, s.dc)), ...F.map(f => P.ref(s.dc.get(f)))];
        return { ...s, rel: { ...r, src: s.rel, part, fns, cols: [...s.rel.cols, ...fns.map(f => f.col)] } };
      }
      case 'values': {
        // Rows reading F: each a projection of D.
        const F = ctx.F.filter(f => fr.has(f));
        const branches = r.rows.map(row => {
          const d = this.D(ctx, F);
          return P.project(d.rel, [...row.map((x, i) => ({ name: r.cols[i].name, expr: this.S(x, d.at), t: r.cols[i].t })), ...F.map(f => ({ name: f.name, expr: P.ref(d.at.get(f)) }))]);
        });
        const u = branches.length === 1 ? branches[0] : P.union(branches);
        const out = P.projectAs(u, [...r.cols.map((c, i) => ({ col: c, expr: P.ref(u.cols[i]) })), ...F.map((f, i) => ({ col: P.newCol(f.name, f.t, { lineage: f.lineage }), expr: P.ref(u.cols[r.cols.length + i]) }))]);
        return { rel: out, dc: new Map(F.map((f, i) => [f, out.cols[r.cols.length + i]])), op: new Map(F.map(f => [f, 'key'])) };
      }
    }
    throw new Error(`unnest: ${r.k} reading a row from outside it`);
  }

  // F' carried through a projection or a grouping: columns of its own.
  carry(s, ctx) {
    const F = ctx.F.filter(f => s.dc.has(f));
    const items = F.map(f => ({ col: P.newCol(f.name, f.t, { lineage: f.lineage }), expr: P.ref(s.dc.get(f)) }));
    return { items, dc: new Map(F.map((f, i) => [f, items[i].col])) };
  }
}

// A condition F = x (or F ≡ x), F of F with no F' yet, x reading no F: { f, x, m }.
function bind(c, F, dc) {
  const m = c.k === 'pop' && (c.op === 'eq' || c.op === 'key') ? c.op : c.k === 'op' && c.op === 'eqs' ? 'key' : null;
  if (!m) return null;
  const Fs = new Set(F);
  const isF = x => x.k === 'ref' && Fs.has(x.col) && !dc.has(x.col);
  const clean = x => !existsOf(x).length && ![...refsOf(x)].some(col => Fs.has(col)) && refsOf(x).size > 0;
  const [l, r] = c.a;
  if (isF(l) && clean(r)) return { f: l.col, x: r, m: m === 'eq' ? 'eq' : 'key' };
  if (isF(r) && clean(l)) return { f: r.col, x: l, m: m === 'eq' ? 'eq' : 'key' };
  return null;
}

// The relation inside L with L's distinct values of F, or more: down a projection that passes
// them on, a distinct, a window, a grouping by them, the side of a join that has them (a left
// join's left keeps each of its rows; an inner join's side has its values and maybe more), a
// definition's rows. More values than L's are no harm: each row R' has for a value L has not is
// dropped by the join to L. { rel, map: F -> its column there }.
function domain(L, F) {
  let r = L, map = new Map(F.map(f => [f, f]));
  for (;;) {
    const cols = [...map.values()];
    const through = (src, m) => (cols.every(c => src.cols.includes(m.get(c) ?? c)) ? { src, m } : null);
    let next = null;
    if (r.k === 'project' || r.k === 'aggregate') {
      const by = new Map((r.k === 'project' ? r.items : r.keys).map(i => [i.col, i.expr]));
      if (cols.every(c => by.get(c)?.k === 'ref')) next = through(r.src, new Map(cols.map(c => [c, by.get(c).col])));
    } else if (r.k === 'distinct' || r.k === 'window') next = through(r.src, new Map());
    else if (r.k === 'join') next = through(r.left, new Map()) ?? (r.kind === 'left' ? null : through(r.right, new Map()));
    else if (r.k === 'shared') next = through(r.def.rel, new Map(r.cols.map((c, i) => [c, r.picks[i]])));
    if (!next) return { rel: r, map };
    map = new Map([...map].map(([f, c]) => [f, next.m.get(c) ?? c]));
    r = next.src;
  }
}

// --- scalars -------------------------------------------------------------------------------

const aggScalars = a => [a.arg, a.extra?.delim, a.extra?.k, ...(a.extra?.order ?? []).map(o => o.expr)];
const mapExtra = (e, S) => (e ? { ...e, ...(e.delim ? { delim: S(e.delim) } : {}), ...(e.k ? { k: S(e.k) } : {}), ...(e.order ? { order: e.order.map(o => ({ ...o, expr: S(o.expr) })) } : {}) } : e);

function scalarsOf1(r) {
  switch (r.k) {
    case 'select': return [r.pred];
    case 'project': return r.items.map(i => i.expr);
    case 'aggregate': return [...r.keys.map(k => k.expr), ...r.aggs.flatMap(aggScalars)].filter(Boolean);
    case 'join': return r.on ? [r.on] : [];
    case 'window': return [...r.part, ...r.fns.flatMap(f => f.order.map(o => o.expr))];
    case 'values': return r.rows.flat();
    case 'series': return [r.start, r.end, r.step];
  }
  return [];
}

function walk(x, f) {
  if (!x || typeof x !== 'object') return;
  f(x);
  if (x.k === 'op' || x.k === 'fn' || x.k === 'pop') x.a.forEach(y => walk(y, f));
  else if (x.k === 'case') { x.w.forEach(([c, v]) => { walk(c, f); walk(v, f); }); walk(x.e, f); }
}
function existsOf(x) {
  const out = [];
  walk(x, y => { if (y.k === 'exists') out.push(y.rel); });
  return out;
}
function mapScalar(x, hook) {
  if (!x || typeof x !== 'object') return x;
  const h = hook(x);
  if (h) return h;
  if (x.k === 'op' || x.k === 'fn' || x.k === 'pop') return { ...x, a: x.a.map(y => mapScalar(y, hook)) };
  if (x.k === 'case') return { ...x, w: x.w.map(([c, v]) => [mapScalar(c, hook), mapScalar(v, hook)]), e: mapScalar(x.e, hook) };
  return x;
}
function substRel(r, map) {
  const fr = free(r);
  if (![...map.keys()].some(c => fr.has(c))) return r;
  return mapScalars(mapKids(r, k => substRel(k, map)), x => subst(x, map));
}
