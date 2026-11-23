// The compiled query -> its query plan (plan.js): the work an engine has to do, as relational
// algebra, with nothing of any engine. It makes emit.js's decisions: the aggregates of a
// SUMMARIZECOLUMNS level over the same rows by the level's keys are one grouping (Fusion); any
// other aggregate is over its own rows, under the filter context as it is, for each row.
//
// A table is built as a Block: a relation (`from`), the joins that reach the columns of the
// tables its rows expand to (added as expressions read them), the applies that compute the
// aggregates its expressions take for each of its rows, its conditions, and what it outputs.
// render() makes it a relation: { rel, list }, list the relation's columns that are the
// table's, in order, as references.
import * as ir from './ir.js';
import * as P from './plan.js';
import { Ctx, narrow } from './context.js';
import { semantic, unsupported } from './errors.js';
import { outputNames, daxName } from './emit.js';
import { canon, text } from './passes/fuse.js';
import { free, subst } from './passes/decorrelate.js';

const lc = s => String(s).toLowerCase();
const withRow = (scope, row, res) => { const s = new Map(scope); s.set(row.id, res); return s; };
const isTrue = x => x.k === 'lit' && x.v === true;
const int = v => ir.lit(v, 'int');
// The SQL CASE of the plan's own operators: { w: [[cond, value]], e }, typed t.
const when = (w, e, t) => ({ k: 'case', w, e, t, nn: false });

// START AT: the rows from the first that is at or after the values, in the order (a blank comes
// first ascending, last descending); each value counts within the rows equal on those before it.
function startAt(keys, order, vals, lits) {
  const after = i => {
    const k = keys[i], v = vals[i], blank = lits[i].v === null;
    if (order[i].desc) return blank ? P.FALSE : P.or([P.cmp('lt', k, v), P.isNull(k)]);
    return blank ? P.notNull(k) : P.cmp('gt', k, v);
  };
  const same = i => P.key(keys[i], vals[i]);
  const alts = vals.map((_, i) => P.and([...vals.slice(0, i).map((__, j) => same(j)), after(i)]));
  alts.push(P.and(vals.map((_, i) => same(i))));
  return P.or(alts);
}

export class Lowerer {
  constructor(model, options = {}) {
    this.model = model;
    this.options = options;
    this.insecure = false;   // inside what is evaluated without row-level security
    this.exactSums = 0;          // > 0 inside a value whose floating-point sums are added exactly
    this.grouping = null;    // GROUPBY's aggregates over CURRENTGROUP(): { aggs, block }
    this.calcBusy = new Set();
    this.defs = [];          // the query's definitions, each before those that read it
    this.defOf = new Map();
    this.fusions = [];       // stack: the Fusion an aggregate goes to, or null (inside a table)
  }

  // f, its aggregates fused into none (a table's, a subquery's: their rows are their own).
  isolated(f) {
    this.fusions.push(null);
    try { return f(); } finally { this.fusions.pop(); }
  }

  // The rows of a definition (a table VAR, a calculated table), built once and read at each use.
  shared(key, build) {
    let d = this.defOf.get(key);
    if (!d) {
      this.defDepth = (this.defDepth ?? 0) + 1;
      try { d = P.definition(build(), 0); } finally { this.defDepth--; }
      this.defs.push(d);
      d.n = this.defs.length;
      this.defOf.set(key, d);
    }
    return P.shared(d);
  }

  unsecured(f) {
    const was = this.insecure;
    this.insecure = true;
    try { return f(); } finally { this.insecure = was; }
  }

  // --- the query ---------------------------------------------------------------------------

  query({ table, row, order, start = [] }) {
    const inner = this.table(table, new Map()).render();
    const outNames = outputNames(table.cols, this.options.columnNames ?? 'short');
    const b = this.fromRendered(inner, table.cols);
    const scope = new Map([[row.id, b.res]]);
    const keys = order.map(o => this.scalar(o.expr, scope, b));
    if (start.length) b.where.push(startAt(keys, order, start.map(v => this.scalar(v, scope, b)), start));
    const by = typeof this.options.castOutput === 'object' ? this.options.castOutput : null;
    const cast = this.options.castOutput !== false;
    const items = table.cols.map((c, i) => ({
      name: outNames[i], expr: inner.list[i].expr,
      by: by?.[c.t] ?? null,
      cast: !by && cast && ir.isNum(c.t) ? (c.t === 'int' ? 'int' : 'double') : null,
    }));
    return {
      plan: P.output(b.body(), items, keys.map((k, i) => ({ expr: k, desc: order[i].desc })), this.defs),
      ordered: order.length > 0,
      columns: table.cols.map((c, i) => ({ name: outNames[i], dax: daxName(c), type: c.t, lineage: c.lineage ? `'${c.lineage.table.name}'[${c.lineage.name}]` : null })),
    };
  }

  // --- tables ------------------------------------------------------------------------------

  table(x, scope) { return this.isolated(() => this.table1(x, scope)); }
  table1(x, scope) {
    switch (x.k) {
      case 'scan': return this.scanBlock(x.table, x.ctx, scope);
      case 'filter': {
        const b = this.open(this.table(x.src, scope));
        const was = this.filtering;
        this.filtering = b;
        try { b.where.push(this.scalar(x.pred, withRow(scope, x.row, b.res), b)); } finally { this.filtering = was; }
        return b;
      }
      case 'project': {
        const b = this.open(this.table(x.src, scope));
        const s2 = withRow(scope, x.row, b.res);
        const kept = x.keep ? b.outList().map(o => o.expr) : [];
        const items = x.items.map(i => this.scalar(i.expr, s2, b));
        b.setOut(x.cols, [...kept, ...items]);
        return b;
      }
      case 'distinct': {
        let b = this.table(x.src, scope);
        if (!b.open) b = this.wrap(b);
        b.distinct = true;
        b.open = false;
        return b;
      }
      case 'group': return this.group(x, scope);
      case 'topn': {
        const b = this.open(this.table(x.src, scope));
        const s2 = withRow(scope, x.row, b.res);
        const order = x.order.map(o => ({ expr: this.scalar(o.expr, s2, b), desc: o.desc, mode: 'dax' }));
        b.qualify = { order, n: this.scalar(x.n, scope, b) };
        b.open = false;
        return b;
      }
      case 'topnskip': return this.topnSkip(x, scope);
      case 'subindex': return this.subIndex(x, scope);
      case 'join': {
        // NATURALINNERJOIN, NATURALLEFTOUTERJOIN: on the common columns, a blank matching a blank.
        const l = this.wrap(this.table(x.left, scope));
        const r = this.table(x.right, scope).render();
        l.joins.push({ kind: x.outer ? 'left' : 'inner', rel: r.rel, on: P.and(x.on.map(([i, j]) => P.same(l.res.col(i), r.list[j].expr))) });
        const list = [...l.res.list, ...x.rest.map(j => ({ expr: r.list[j].expr, lineage: x.right.cols[j].lineage, name: x.right.cols[j].name }))];
        l.res = new WrapRes(this, l, list, l.res.state);
        l.cols = x.cols;
        return l;
      }
      case 'cross': {
        const parts = x.srcs.map(s => this.table(s, scope).render());
        let rel = parts[0].rel;
        for (const p of parts.slice(1)) rel = P.join('cross', rel, p.rel);
        return this.fromList(rel, parts.flatMap(p => p.list), x.cols);
      }
      case 'union': {
        const parts = x.srcs.map(s => this.exact(this.table(s, scope).render()));
        return this.fromRel(P.union(parts), x.cols);
      }
      case 'intersect': case 'except': {
        const b = this.wrap(this.table(x.srcs[0], scope));
        for (const s of x.srcs.slice(1)) {
          const r = this.table(s, scope).render();
          const has = P.exists(P.select(r.rel, P.and(x.cols.map((_, i) => P.same(r.list[i].expr, b.res.col(i))))));
          b.where.push(x.k === 'except' ? P.not(has) : has);
        }
        return b;
      }
      case 'rows': return this.rowsBlock(x, scope);
      case 'series': {
        const b = new Block(this, null, x.cols);
        const [start, end, step] = [x.start, x.end, x.step].map(v => this.scalar(v, scope, b));
        // Bounds that are aggregates (CALENDARAUTO's): columns of the one row that holds them.
        return this.fromRel(P.series(start, end, step, x.cols[0].t, x.cols[0].name, b.applies.length ? b.body() : null), x.cols);
      }
      case 'generate': {
        const l = this.wrap(this.table(x.left, scope));
        const r = this.table(x.right, withRow(scope, x.lrow, l.res)).render();
        l.applies.push({ rel: r.rel, outer: x.outer });
        const list = [...l.res.list, ...r.list.map((o, i) => ({ ...o, lineage: x.right.cols[i].lineage }))];
        l.res = new WrapRes(this, l, list, l.res.state);
        l.cols = x.cols;
        return l;
      }
      // A table VAR: evaluated once (one that reads a row around it, for each).
      case 'shared':
        if (ir.freeRows(x.src).size) return this.table(x.src, scope);
        return this.fromRel(this.shared(x, () => this.exact(this.table(x.src, new Map()).render())), x.cols);
      case 'sc': return this.summarizeColumns(x, scope);
      case 'window': return this.windowRows(x, scope);
      case 'prefix': {
        const b = this.wrap(this.table(x.src, scope));
        const vals = x.vals.map(v => this.scalar(v, scope, b));
        b.setOut(x.cols, [...vals, ...b.outList().map(o => o.expr)]);
        if (!isTrue(x.cond)) b.where.push(this.scalar(x.cond, scope, b));
        b.open = false;
        return b;
      }
      case 'onerow': {
        const b = new Block(this, null, x.cols);
        b.setOut(x.cols, x.vals.map(v => this.scalar(v, scope, b)));
        if (!isTrue(x.cond)) b.where.push(this.scalar(x.cond, scope, b));
        b.open = false;
        return b;
      }
      case 'currentgroup': throw semantic('CURRENTGROUP() is only valid in an aggregate inside GROUPBY');
    }
    throw unsupported(`plan: table ${x.k}`);
  }

  // The rows of a model table the filter context keeps. self: [row, cols], a row whose columns
  // are the scan's own (cols[i] its i-th), for filters that read the keys the scan is grouped by.
  scanBlock(table, ctx, scope, excluded = null, self = null) {
    const rel = this.source(table);
    const b = new Block(this, rel, table.columns.map(c => ({ name: c.name, lineage: c, t: c.type })));
    b.res = new ScanRes(this, b, table, rel, this.model.state(ctx.mods));
    if (self) {
      const [row, cols] = self, res = b.res;
      scope = withRow(scope, row, { block: b, col: r => res.meta(typeof r === 'number' ? cols[r] : r), meta: m => res.meta(m) });
    }
    b.where.push(...this.conds(table, ctx, b.res, scope, excluded), ...this.securityConds(table, b.res, scope));
    return b;
  }

  // A model table's rows: its stored rows; a calculated table's expression (as at refresh: no
  // filter, no security); a calculation group's items.
  source(table) {
    if (table.calc) return this.shared(table, () => {
      const x = this.options.calcTable(table);
      const inner = this.unsecured(() => this.table(x, new Map()).render());
      const strip = s => lc(String(s).replace(/^.*\[(.*)\]$/, '$1'));
      const cols = table.columns.filter(c => !c.expr);
      return P.project(inner.rel, cols.map((c, i) => {
        let j = x.cols.findIndex(o => lc(o.name) === strip(c.source));
        if (j < 0) j = x.cols.findIndex(o => lc(o.name) === lc(c.name));
        if (j < 0 && x.cols.length === cols.length) j = i;
        if (j < 0) throw semantic(`calculated table '${table.name}': its expression has no column ${c.source}`);
        return { name: c.name, expr: inner.list[j].expr, lineage: c, t: c.type, table };
      }));
    });
    if (table.calcGroup) {
      const g = table.calcGroup;
      const cols = [g.column, g.ordinal].filter(Boolean);
      const rows = g.items.map(it => [ir.lit(it.name, 'string'), ...(g.ordinal ? [ir.lit(it.ordinal, g.ordinal.type)] : [])]);
      return P.values(rows, cols.map(c => P.newCol(c.name, c.type, { lineage: c, table })));
    }
    return P.scan(table);
  }

  // Row-level security on a scan of `table`: a row is kept when some role keeps it.
  securityConds(table, res, scope) {
    const roles = this.options.security;
    if (!roles?.length || this.insecure) return [];
    const per = roles.map(role => this.unsecured(() => this.conds(table, role.ctx, res, scope)));
    if (per.some(c => !c.length)) return [];
    return [P.or(per.map(c => P.and(c)))];
  }

  // As emit.js: two join paths from a secured table to `table` are an error.
  securityTree(table, rel, state) {
    const roles = this.options.security;
    if (!roles?.length || this.insecure) return;
    for (const f of roles.flatMap(r => r.filters)) {
      const two = this.model.securityPaths(f.table, table, state, rel);
      if (!two) continue;
      const path = p => p.map(t => `'${t.name}'`).join('->');
      throw semantic(`join paths must form a tree, but '${f.table.name}' has two join paths to '${table.name}' under row-level security: ${path(two[0])} and ${path(two[1])}`);
    }
  }

  // The filter context applied to a scan of `table` (res): every filter on a column of its
  // expanded table, and the filters that reach it over bidirectional and many-to-many
  // relationships.
  conds(table, ctx, res, scope, excluded = null) {
    if (!ctx.filters.length) return [];
    const state = this.model.state(ctx.mods);
    const exp = this.model.expand(table, state, excluded);
    const inExp = c => exp.has(c.table.name);
    const blk = res.block, out = [];
    for (const f of ctx.filters) {
      const D = f.cols.filter(inExp);
      if (!D.length) continue;
      if (f.kind === 'bind') {
        if (f.implied && ctx.filters.includes(f.implied)) continue;
        out.push(P.same(res.meta(D[0]), this.scalar(f.val, scope, blk)));
        if (f.guard) out.push(this.scalar(f.guard, scope, blk));
      } else if (f.kind === 'pred' && D.length === f.cols.length) out.push(this.scalar(f.pred, withRow(scope, f.row, res), blk));
      else out.push(this.relCond(f.kind === 'pred' ? narrow(f, D) : f, D, res, scope, state));
    }
    for (const name of exp.keys()) {
      for (const e of this.model.inbound(this.model.table(name), state)) {
        const X = e.there.table;
        if (exp.has(X.name) || excluded?.has(X.name)) continue;
        const skip = new Set([...(excluded ?? []), ...exp.keys()]);
        if (!this.unsecured(() => this.scanBlock(X, ctx, scope, skip)).where.length) continue;
        this.securityTree(this.model.table(name), e.rel, state);
        const sb = this.scanBlock(X, ctx, scope, skip);
        sb.setOut([{ name: 'k', lineage: null }], [sb.res.meta(e.there)]);
        const sub = sb.render(), k = sub.list[0].expr, here = res.meta(e.here);
        // A many-to-many relationship matches a blank with a blank.
        const mm = e.rel.fromCard === 'many' && e.rel.toCard === 'many';
        out.push(P.exists(P.select(sub.rel, mm ? P.same(k, here) : P.eq(k, here))));
      }
    }
    return out;
  }

  // A filter that is a table, on the columns D of the scan's expanded table: the row's values
  // are one of its rows, a blank matching a blank.
  relCond(f, D, res, scope, state) {
    if (!f.base) {
      const sub = this.table(f.src, scope).render();
      const on = D.map(c => P.same(sub.list[f.idx[f.cols.indexOf(c)]].expr, res.meta(c)));
      return P.exists(P.select(sub.rel, P.and(on)));
    }
    // Rows of a model table: matched on the keys of the tables whose key the filter holds, and
    // on the columns of the others.
    const tables = [...new Set(D.map(c => c.table))];
    const covered = tables.filter(V => V.key && f.cols.includes(V.key));
    const minimal = covered.filter(V => !covered.some(W => W !== V && this.model.expand(W, state).has(V.name)));
    const settled = new Set(minimal.flatMap(W => [...this.model.expand(W, state).keys()]));
    const cols = [...minimal.map(V => V.key), ...D.filter(c => !settled.has(c.table.name))];
    const b = this.open(this.table(f.src, scope));
    b.setOut(cols.map(c => ({ name: c.name, lineage: c })), cols.map(c => b.res.meta(c)));
    const sub = b.render();
    return P.exists(P.select(sub.rel, P.and(cols.map((c, i) => P.same(sub.list[i].expr, res.meta(c))))));
  }

  // A block whose input row is its output: extend it, or wrap it if it is not.
  open(b) { return b.open && b.plain ? b : this.wrap(b); }
  wrap(b) { return this.fromRendered(b.render(), b.cols); }
  fromRendered(r, cols) { return this.fromList(r.rel, r.list, cols); }
  fromList(rel, list, cols) {
    const b = new Block(this, rel, cols);
    b.res = new WrapRes(this, b, list.map((o, i) => ({ ...o, lineage: cols[i]?.lineage ?? o.lineage ?? null })), this.model.state(null));
    return b;
  }
  fromRel(rel, cols) {
    return this.fromList(rel, rel.cols.map((c, i) => ({ expr: P.ref(c), lineage: cols[i]?.lineage ?? c.lineage, name: c.name })), cols);
  }
  // A rendered block as a relation of exactly its columns, in order.
  exact(r) {
    if (r.rel.cols.length === r.list.length && r.list.every((o, i) => o.expr.k === 'ref' && o.expr.col === r.rel.cols[i])) return r.rel;
    return P.project(r.rel, r.list.map(o => ({ name: o.name, expr: o.expr, lineage: o.lineage })));
  }

  // GROUPBY: the rows grouped by the keys, the aggregates over CURRENTGROUP() of each group.
  group(x, scope) {
    const b = this.open(this.table(x.src, scope));
    const s2 = withRow(scope, x.row, b.res);
    const keys = x.keys.map(k => ({ name: k.name, expr: this.scalar(k.expr, s2, b), lineage: k.lineage ?? null }));
    const aggs = [], was = this.grouping;
    this.grouping = { aggs, block: b, scope: s2 };
    let items;
    try { items = x.items.map(i => this.scalar(i.expr, s2, b)); } finally { this.grouping = was; }
    const g = P.aggregate(b.body(), keys, aggs);
    // A key column read again in an item is the group's.
    const byCol = new Map(keys.map((k, i) => [k.expr.k === 'ref' ? k.expr.col : null, g.keys[i].col]).filter(([c]) => c));
    const own = new Set(g.cols);
    const after = e => {
      if (e.k === 'ref') {
        if (own.has(e.col)) return e;
        if (byCol.has(e.col)) return P.ref(byCol.get(e.col));
        throw unsupported('plan: a GROUPBY expression that reads a column it is not grouped by');
      }
      if (e.k === 'op' || e.k === 'fn') return { ...e, a: e.a.map(after) };
      if (e.k === 'case') return { ...e, w: e.w.map(([c, v]) => [after(c), after(v)]), e: after(e.e) };
      return e;
    };
    const out = this.fromRel(g, []);
    out.setOut(x.cols, [...g.keys.map(k => P.ref(k.col)), ...items.map(after)]);
    out.open = false;
    return out;
  }

  // The rows of table `src` numbered in the order (`fn`: row_number, dense_rank), ties broken
  // by every column: { rel, list (its columns), rn }.
  ranked(src, row, order, scope, fn) {
    const b = this.wrap(this.table(src, scope));
    const s2 = withRow(scope, row, b.res);
    const base = b.outList();
    const os = order.map(o => this.scalar(o.expr, s2, b));
    b.setOut([...src.cols, ...os.map((_, i) => ({ name: `o${i}` }))], [...base.map(o => o.expr), ...os]);
    const r = b.render(), n = src.cols.length;
    const terms = [...order.map((o, i) => ({ expr: r.list[n + i].expr, desc: o.desc, blanks: o.blanks, t: o.t, mode: 'term' })),
      ...r.list.slice(0, n).map(o => ({ expr: o.expr, mode: 'plain' }))];
    const w = P.window(r.rel, [], [{ name: 'rn', fn, order: terms }]);
    return { rel: w, list: r.list.slice(0, n), rn: w.fns[0].col };
  }

  // TOPNSKIP: the rows whose place is after `skip`, n of them; rows equal in every column share a place.
  topnSkip(x, scope) {
    const rk = this.ranked(x.src, x.row, x.order, scope, 'dense_rank');
    const b = this.fromList(rk.rel, rk.list, x.src.cols);
    const n = this.scalar(x.n, scope, b), k = this.scalar(x.skip, scope, b);
    const rn = P.ref(rk.rn), skip = P.coalesce(k, int(0));
    b.where.push(P.and([P.cmp('gt', rn, skip), P.cmp('le', rn, P.add(skip, n))]));
    b.setOut(x.cols, rk.list.map(o => o.expr));
    b.open = false;
    return b;
  }

  // SUBSTITUTEWITHINDEX: the rows joined to the index's on the common columns, a blank matching
  // a blank, those replaced by the first matching row's place, from 0.
  subIndex(x, scope) {
    const rk = this.ranked(x.idx, x.row, x.order, scope, 'row_number');
    const first = P.newCol('first', 'int');
    const g = P.aggregate(rk.rel, x.on.map(([, j], k) => ({ name: `k${k}`, expr: rk.list[j].expr })), [{ col: first, fn: 'min', arg: P.ref(rk.rn), extra: { t: 'int' } }]);
    const b = this.wrap(this.table(x.src, scope));
    b.joins.push({ kind: 'inner', rel: g, on: P.and(x.on.map(([i], k) => P.same(b.res.col(i), P.ref(g.keys[k].col)))) });
    b.setOut(x.cols, [...x.rest.map(i => b.res.col(i)), P.sub(P.ref(first), int(1))]);
    b.open = false;
    return b;
  }

  rowsBlock(x, scope) {
    const block = r => {
      const b = new Block(this, null, x.cols);
      b.setOut(x.cols, r.map(v => this.scalar(v, scope, b)));
      b.open = false;
      return b;
    };
    const cols = () => x.cols.map(c => P.newCol(c.name, c.t, { lineage: c.lineage }));
    if (x.rows.every(r => r.every(v => v.k === 'lit'))) return this.fromRel(P.values(x.rows, cols()), x.cols);
    if (x.rows.length === 1) return block(x.rows[0]);
    return this.fromRel(P.union(x.rows.map(r => this.exact(block(r).render()))), x.cols);
  }

  // --- window functions -------------------------------------------------------------------

  // The relation's rows with their number in the partition (ties broken by every column), its
  // size, and their rank: { rel, own (the relation's columns), parts, rn, n, rank, drank }.
  numbered(x, scope) {
    const b = this.wrap(this.table(x.rel, scope));
    const s2 = withRow(scope, x.row, b.res);
    const base = b.outList();
    const os = x.order.map(o => this.scalar(o.expr, s2, b)), ps = x.parts.map(p => this.scalar(p, s2, b));
    b.setOut([...x.rel.cols, ...os.map((_, i) => ({ name: `o${i}` })), ...ps.map((_, i) => ({ name: `p${i}` }))],
      [...base.map(o => o.expr), ...os, ...ps]);
    const r = b.render(), n = x.rel.cols.length;
    const own = r.list.slice(0, n).map(o => o.expr);
    const parts = r.list.slice(n + os.length).map(o => o.expr);
    const order = x.order.map((o, i) => ({ expr: r.list[n + i].expr, desc: o.desc, blanks: o.blanks, t: o.t, mode: 'term' }));
    const ties = own.map(e => ({ expr: e, mode: 'plain' }));
    const w = P.window(r.rel, parts, [
      { name: 'rn', fn: 'row_number', order: [...order, ...ties] },
      { name: 'n', fn: 'count', order: [] },
      { name: 'rank', fn: 'rank', order: order.length ? order : ties },
      { name: 'drank', fn: 'dense_rank', order: order.length ? order : ties },
    ]);
    const [rn, cnt, rank, drank] = w.fns.map(f => P.ref(f.col));
    return { rel: w, own, parts, rn, n: cnt, rank, drank };
  }

  // The numbered rows that are the current row: its columns hold the outer values, and those
  // with none hold a value they have in the filter context.
  currentRows(x, scope, num) {
    const b = new Block(this, num.rel, []);
    for (const m of x.match) b.where.push(P.same(num.own[m.i], this.scalar(m.val, scope, b)));
    if (x.unbound) {
      const u = this.table(x.unbound.table, scope).render();
      b.where.push(P.exists(P.select(u.rel, P.and(x.unbound.idx.map((i, j) => P.same(u.list[j].expr, num.own[i]))))));
    }
    return b.body();
  }

  // INDEX, OFFSET, WINDOW: the rows at the position, the offset or within the window, in the
  // current row's partition.
  windowRows(x, scope) {
    const r = this.numbered(x, scope);
    let b, c = null;
    if (x.needCur) {
      // The current rows: of a numbering of their own (the plan's columns are each one relation's).
      const cn = this.numbered(x, scope);
      let cur = this.currentRows(x, scope, cn);
      let parts = cn.parts, crn = cn.rn;
      // INDEX, and WINDOW with both ends absolute: once per current partition.
      if (x.fn === 'index' || x.fn === 'window' && x.fromAbs && x.toAbs) {
        cur = P.distinct(P.project(cur, parts.length ? parts.map((p, i) => ({ name: `p${i}`, expr: p })) : [{ name: 'one', expr: ir.lit(1) }]));
        parts = parts.length ? cur.cols.map(col => P.ref(col)) : [];
        crn = null;
      }
      b = new Block(this, P.join('cross', r.rel, cur), x.rel.cols);
      b.where.push(...r.parts.map((p, i) => P.same(p, parts[i])));
      c = crn;
    } else b = new Block(this, r.rel, x.rel.cols);
    const rn = r.rn, n = r.n;
    // A position from the start (> 0) or from the end (< 0) of the partition of n rows.
    const fromEnd = v => P.add(P.add(n, v), int(1));
    if (x.fn === 'offset') b.where.push(P.eq(rn, P.add(c, this.scalar(x.delta, scope, b))));
    else if (x.fn === 'index') {
      const p = this.scalar(x.pos, scope, b);
      b.where.push(P.eq(rn, when([[P.cmp('gt', p, int(0)), p], [P.cmp('lt', p, int(0)), fromEnd(p)]], ir.lit(null, 'int'), 'int')));
    } else {
      const f = this.scalar(x.from, scope, b), t = this.scalar(x.to, scope, b);
      // An absolute end: its position (0 is the first row); a relative one: from the current row.
      const end = (v, abs) => (abs ? when([[P.cmp('gt', v, int(0)), v], [P.eq(v, int(0)), int(1)]], fromEnd(v), 'int') : P.add(c, v));
      b.where.push(P.and([P.cmp('ge', rn, end(f, x.fromAbs)), P.cmp('le', rn, end(t, x.toAbs))]));
    }
    b.setOut(x.rel.cols, r.own);
    b.open = false;
    return b;
  }

  // --- SUMMARIZECOLUMNS ----------------------------------------------------------------

  summarizeColumns(x, scope) {
    const levels = x.levels.map(L => this.level(x, L, scope));
    return this.fromRel(levels.length === 1 ? levels[0] : P.union(levels), x.cols);
  }

  // One level: every combination of its keys' values (keyCombinations), each with the values
  // of the expressions there, the rows where every expression is blank left out.
  level(x, L, scope) {
    const active = L.active.map(c => x.keyCols.indexOf(c));
    const counted = L.items.filter(i => !i.ignore);
    let keyRel, refs = new Map();
    if (active.length && counted.length && counted.every(i => blankOnly(i.expr))) {
      keyRel = P.values([], active.map(ki => P.newCol(x.keyCols[ki].name, x.keyCols[ki].type, { lineage: x.keyCols[ki] })));
      active.forEach((ki, j) => refs.set(ki, P.ref(keyRel.cols[j])));
    } else if (active.length) ({ rel: keyRel, refs } = this.keyCombinations(x, L, scope));
    else keyRel = P.oneRow();
    const kb = new Block(this, keyRel, x.cols);
    kb.res = new WrapRes(this, kb, x.keyCols.map((c, i) => ({ expr: refs.get(i) ?? ir.lit(null, c.type), lineage: c, name: c.name })), this.model.state(x.ctx0.mods));
    const s = withRow(scope, x.keyRow, kb.res);
    // The filters that decide which combinations of the keys there are (keyFilters).
    const domain = [...new Set([...new Set(L.active.map(c => c.table))].flatMap(t => this.keyFilters(x, t, true)))];
    const fusion = new Fusion(this, x.keyRow, active, x.keyCols, domain);
    this.fusions.push(fusion);
    let items;
    try { items = L.items.map(i => this.scalar(i.expr, s, kb)); } finally { this.fusions.pop(); }
    fusion.finish(kb, ki => refs.get(ki));
    kb.setOut(x.cols, [
      ...x.keyCols.map((c, i) => (active.includes(i) ? refs.get(i) : ir.lit(L.consts?.has(i) ? L.consts.get(i) : null, c.type))),
      ...L.flags.map(f => ir.lit(f, 'bool')),
      ...items.map((v, i) => (v.k === 'lit' && v.v === null ? ir.lit(null, x.cols[x.keyCols.length + L.flags.length + i]?.t ?? v.t) : v)),
    ]);
    let r = kb.render();
    if (counted.length) {
      const z = this.fromRendered(r, x.cols), n0 = x.keyCols.length + L.flags.length;
      z.where.push(P.or(L.items.map((it, i) => (it.ignore ? null : P.notNull(z.res.col(n0 + i)))).filter(Boolean)));
      r = z.render();
    }
    return this.exact(r);
  }

  // The filters that decide which values the grouping columns of table t take (as emit.js);
  // `of`: the filters they come from (not narrowed to t's columns).
  keyFilters(x, t, of = false) {
    const state = this.model.state(x.ctx0.mods), out = [];
    for (const f of x.ctx0.filters) {
      if (x.outer.includes(f)) {
        if (f.cols.some(c => this.model.reaches(c.table, t, state))) out.push(f);
      } else if (f.kind === 'rel' && f.base) {
        if (f.base === t) out.push(f);
      } else {
        const own = f.cols.filter(c => c.table === t);
        if (own.length) out.push(own.length === f.cols.length || of ? f : narrow(f, own));
      }
    }
    return out;
  }

  // Every combination of the grouping columns' values: within a table those it holds, under the
  // filters on it; across tables, all. -> { rel, refs: key index -> its column }
  keyCombinations(x, L, scope) {
    const byTable = new Map();
    for (const c of L.active) {
      if (!byTable.has(c.table)) byTable.set(c.table, []);
      byTable.get(c.table).push(c);
    }
    let rel = null;
    const refs = new Map();
    for (const [t, cols] of byTable) {
      const b = this.scanBlock(t, new Ctx(this.keyFilters(x, t), x.ctx0.mods), scope);
      b.setOut(cols.map(c => ({ name: c.name, lineage: c })), cols.map(c => b.res.meta(c)));
      b.distinct = true;
      const part = this.exact(b.render());
      cols.forEach((c, j) => refs.set(x.keyCols.indexOf(c), P.ref(part.cols[j])));
      rel = rel ? P.join('cross', rel, part) : part;
    }
    return { rel, refs };
  }

  // --- scalars ---------------------------------------------------------------------------

  // A value, over the columns of the rows in scope; an aggregate it takes is an apply on block
  // `blk` (the block whose expressions it is in).
  scalar(x, scope, blk) {
    switch (x.k) {
      case 'lit': return x;
      case 'col': {
        const res = scope.get(x.row.id);
        if (!res) throw new Error(`plan: no row ${x.row.id} in scope`);
        return res.col(x.ref);
      }
      case 'op': return { ...x, shared: false, a: x.a.map(v => this.scalar(v, scope, blk)) };
      case 'fn': {
        // A value written twice and compared (RANKX's): its sums are added exactly.
        if (x.name === 'same') {
          this.exactSums++;
          try { return this.scalar(x.a[0], scope, blk); } finally { this.exactSums--; }
        }
        return { ...x, shared: false, a: x.a.map(v => this.scalar(v, scope, blk)) };
      }
      case 'case': return { ...x, shared: false, w: x.w.map(([c, v]) => [this.scalar(c, scope, blk), this.scalar(v, scope, blk)]), e: this.scalar(x.e, scope, blk) };
      case 'agg': return this.agg(x, scope, blk);
      case 'exists': return P.exists(this.table(x.src, scope).render().rel);
      case 'insub': {
        const sub = this.table(x.src, scope).render();
        const left = x.e.map(e => this.scalar(e, scope, blk));
        return P.exists(P.select(sub.rel, P.and(left.map((l, j) => P.same(sub.list[j].expr, l)))));
      }
      case 'wrank': {
        // The current row's rank; several current rows (rows that differ, or ROWNUMBER's equal
        // rows) give no value.
        if (!blk) throw unsupported('plan: a rank where no row is');
        const num = this.numbered(x, scope);
        const cur = this.currentRows(x, scope, num);
        const r = x.fn === 'rownumber' ? num.rn : x.dense ? num.drank : num.rank;
        const dd = P.distinct(P.project(cur, [...num.own.map((e, i) => ({ name: x.rel.cols[i].name, expr: e })), { name: 'r', expr: r }]));
        const v = P.newCol('rank', 'int');
        blk.applies.push({ rel: P.aggregate(dd, [], [{ col: v, fn: 'onlyone', arg: P.ref(dd.cols.at(-1)), extra: {} }]), outer: false });
        return P.ref(v);
      }
    }
    throw unsupported(`plan: scalar ${x.k}`);
  }

  // An aggregate: over its table's rows, for each row of `blk` (an apply), or GROUPBY's.
  agg(x, scope, blk) {
    if (x.src.k === 'currentgroup') {
      if (!this.grouping) throw semantic('CURRENTGROUP() is only valid in an aggregate inside GROUPBY');
      const col = P.newCol(x.fn, x.t);
      this.grouping.aggs.push({ col, ...this.aggParts(x, scope, this.grouping.block) });
      return P.ref(col);
    }
    const fusion = this.fusions.at(-1);
    if (fusion) {
      const v = fusion.add(x, scope, blk);
      if (v) return v;
    }
    if (!blk) throw unsupported('plan: an aggregate where no row is');
    // The same aggregate (the same node: a measure an expression names more than once, a
    // calculation item's SELECTEDMEASURE in several items) for the same rows in scope: computed
    // once, as emit.js's repeatedValues are.
    const memo = blk.memo ??= new Map(), seen = memo.get(x);
    const exact = this.exactSums > 0;
    if (seen && seen.scope === scope && seen.exact === exact) return seen.v;
    const v = this.isolated(() => this.agg1(x, scope, blk));
    memo.set(x, { scope, exact, v });
    return v;
  }
  agg1(x, scope, blk) {
    const b = this.open(this.table(x.src, scope));
    const s2 = withRow(scope, x.row, b.res);
    const col = P.newCol(x.fn === 'single' ? 'value' : x.fn, x.t);
    const a = x.fn === 'single' ? { fn: 'single', arg: this.scalar(x.arg, s2, b), extra: {} } : this.aggParts(x, s2, b);
    const rel = (x.src.k === 'scan' && ir.freeRows(x).size && this.groupedFirst(b, a, col, x.src.table)) || P.aggregate(b.body(), [], [{ col, ...a }]);
    (this.hoist(x, scope, blk) ?? blk).applies.push({ rel, outer: false });
    return P.ref(col);
  }

  // An aggregate that reads the row around it (block b of a scan of `table`, parts a) over the
  // table's rows grouped first, or null to write it as it is (emit.js's groupedFirst). Each outer
  // row otherwise reads the table's every row: last year's sales by month is the fact joined to
  // its dates for each month. The table is grouped once, one definition, by the columns of its
  // own that the joins and the conditions on other rows read (its date key), under the
  // conditions on its own columns alone; the aggregate then adds up those groups. For sums,
  // counts, minima and maxima of the table's own columns, by three columns at most.
  groupedFirst(b, a, col, table) {
    const OVER = { sum: 'sum', min: 'min', max: 'max', count: 'sum', countrows: 'sum', count0: 'sum' };
    if (!OVER[a.fn] || a.extra?.exact || a.extra?.k || a.extra?.delim || b.distinct || b.qualify || b.applies.length || b.from?.k !== 'scan') return null;
    const base = new Set(b.from.cols);
    const own = e => { const r = scalarReads(e); return !r.query && [...r.cols].every(c => base.has(c)); };
    if (a.arg && !own(a.arg)) return null;
    const outer = b.where.filter(c => !own(c)), inner = b.where.filter(own);
    const cols = [...new Set([...b.joins.map(j => j.on), ...outer].flatMap(e => [...scalarReads(e).cols].filter(c => base.has(c))))];
    if (!cols.length || cols.length > 3) return null;
    // By more than one column only where a condition is a set of values (the dates of last year):
    // rows that each name one value of every column find their few rows faster in the table.
    if (cols.length > 1 && !outer.some(c => scalarReads(c).query)) return null;
    // Not by a column that names one row (the table's key, the one side of a relationship).
    const unique = [table.key, ...this.model.oneSides(table).map(o => o.one)].filter(Boolean);
    if (cols.some(c => unique.includes(c.lineage))) return null;
    const v = P.newCol(a.fn, col.t);
    const G = P.aggregate(inner.length ? P.select(b.from, P.and(inner)) : b.from,
      cols.map(c => ({ name: c.name, expr: P.ref(c), lineage: c.lineage })), [{ col: v, fn: a.fn, arg: a.arg, extra: a.extra }]);
    const s = this.shared(`grouped|${canon(G, true).key}`, () => G);
    const map = new Map(cols.map((c, i) => [c, s.cols[i]]));
    let r = s;
    for (const j of b.joins) r = P.join(j.kind, r, j.rel, subst(j.on, map));
    if (outer.length) r = P.select(r, P.and(outer.map(c => subst(c, map))));
    const sv = P.ref(s.cols[cols.length]);
    if (a.fn !== 'count0') return P.aggregate(r, [], [{ col, fn: OVER[a.fn], arg: sv, extra: { ...a.extra, t: col.t } }]);
    const t = P.newCol('sum', col.t);
    return P.projectAs(P.aggregate(r, [], [{ col: t, fn: 'sum', arg: sv, extra: { t: col.t } }]), [{ col, expr: P.coalesce(P.ref(t), ir.lit(0, col.t)) }]);
  }

  // The block an aggregate in a filter's condition is computed in when it reads none of the row
  // the filter tests (a window's bound, the current dates' last, beside each date of the window):
  // the innermost block whose row it reads, in the same definition and still to be rendered, once
  // for each of its rows, not for each row the filter tests. Null: the block it is in. (A value
  // in an aggregate's argument stays: SQL reads an aggregate of the row around it as that row's.)
  hoist(x, scope, blk) {
    if (this.filtering !== blk) return null;
    const blocks = [...ir.freeRows(x)].map(id => scope.get(id)?.block).filter(Boolean);
    if (!blocks.length || blocks.includes(blk)) return null;
    const t = blocks.reduce((a, b) => (b.serial > a.serial ? b : a));
    return t.rendered || t.defDepth !== blk.defDepth ? null : t;
  }

  aggParts(x, scope, b) {
    const arg = x.arg ? this.scalar(x.arg, scope, b) : null;
    const extra = { t: x.arg?.t, ...(this.exactSums ? { exact: true } : {}) };
    if (x.fn === 'concat') {
      extra.delim = this.scalar(x.a[0], scope, b);
      extra.order = (x.order ?? []).map(o => ({ expr: this.scalar(o.expr, scope, b), desc: o.desc }));
      extra.text = x.arg.t;
    } else if (/^pctx?_/.test(x.fn)) extra.k = this.scalar(x.a[0], scope, b);
    return { fn: x.fn, arg, extra };
  }
}

// --- fusion ------------------------------------------------------------------------------

// The aggregates of one SUMMARIZECOLUMNS level that can share a grouping (emit.js's Fusion): over
// a scan, reading no row but the level's keys, which they filter it by. A group is one grouping:
// the scan's table and its other filters (compared as plan, up to columns' ids), by the keys
// that filter it, joined to the level's rows on them (a blank matching a blank); an aggregate
// the same in it as another is the other.
class Fusion {
  constructor(lw, keyRow, active, keyCols, domain = []) {
    this.lw = lw;
    this.keyRow = keyRow;
    this.active = active;
    this.keyCols = keyCols;
    this.domain = domain;
    this.groups = [];
  }

  // The mapping of filter f (a table filter, on its column c, reading keys `refs` of the key
  // row): every combination of those keys' values (under the filters that decide the level's
  // combinations: a level's seven dates, not the calendar's) beside each value f's table holds
  // for them, f's table under each one's (an apply). One definition, read where it is joined:
  // { rel, k: [its keys], v }.
  mapping(f, refs, c, state) {
    const lw = this.lw;
    const byTable = new Map();
    for (const i of refs) {
      const t = this.keyCols[i].table;
      if (!byTable.has(t)) byTable.set(t, []);
      byTable.get(t).push(i);
    }
    const dom = new Ctx(this.domain);
    let D = null;
    const kcol = new Map();
    for (const [t, is] of byTable) {
      const b = lw.isolated(() => lw.scanBlock(t, dom, new Map()));
      b.setOut(is.map(i => ({ name: `k${i}`, lineage: null })), is.map(i => b.res.meta(this.keyCols[i])));
      b.distinct = true;
      const part = lw.exact(b.render());
      is.forEach((i, j) => kcol.set(i, part.cols[j]));
      D = D ? P.join('cross', D, part) : part;
    }
    const db = new Block(lw, D, []);
    db.res = new WrapRes(lw, db, this.keyCols.map((k, i) => ({ expr: kcol.has(i) ? P.ref(kcol.get(i)) : ir.lit(null, k.type), lineage: k, name: k.name })), state);
    const sb = lw.isolated(() => lw.table(f.src, withRow(new Map(), this.keyRow, db.res)).render());
    // A filter of a table's rows (f.base) has no idx: its columns are the table's, by lineage.
    const at = f.idx ? f.idx[f.cols.indexOf(c)] : f.src.cols.findIndex(y => y.lineage === c);
    if (at < 0 || !sb.list[at]) return null;
    db.applies.push({ rel: sb.rel, outer: false });
    db.setOut([...refs.map(i => ({ name: `k${i}`, lineage: null })), { name: 'v', lineage: null }], [...refs.map(i => P.ref(kcol.get(i))), sb.list[at].expr]);
    db.distinct = true;
    const rel = lw.exact(db.render());
    const s = lw.shared(`mapping|${canon(rel, true).key}`, () => rel);
    return { rel: s, k: refs.map((_, j) => P.ref(s.cols[j])), v: P.ref(s.cols[refs.length]) };
  }

  // Aggregate x as a column of its group, or null (not fused: computed for each row).
  add(x, scope, blk) {
    const lw = this.lw, S = x.src;
    // MIN or MAX over the distinct values of a scan's column (VALUES, MAX of the visible dates):
    // over the scan's rows, the same values.
    if ((x.fn === 'min' || x.fn === 'max') && S.k === 'distinct' && S.src.k === 'project' && !S.src.keep && S.src.src.k === 'scan'
      && x.arg?.k === 'col' && x.arg.row === x.row) {
      const at = typeof x.arg.ref === 'number' ? x.arg.ref : S.cols.findIndex(c => c.lineage === x.arg.ref);
      const item = S.src.items[at];
      if (item?.expr.k === 'col' && item.expr.row === S.src.row) return this.add({ ...x, src: S.src.src, row: S.src.row, arg: item.expr }, scope, blk);
    }
    if (S.k !== 'scan' || x.fn === 'single') return null;
    const kid = this.keyRow.id;
    const state = lw.model.state(S.ctx.mods);
    const exp = lw.model.expand(S.table, state);
    // A bind of a column that does not filter the scan (a group's country on a scan of rates) is
    // left out: it reads no row of the scan's. So is one a filter replaces.
    const idle = f => f.kind === 'bind' && (f.implied && S.ctx.filters.includes(f.implied) || !exp.has(f.cols[0].table.name) && !lw.model.reaches(f.cols[0].table, S.table, state));
    const reads = f => ir.freeRows({ k: 'scan', ctx: new Ctx([f]) });
    for (const id of ir.freeRows(x)) {
      if (id === kid) continue;
      for (const f of S.ctx.filters) if (!idle(f) && reads(f).has(id)) return null;
    }
    for (const part of [x.arg, ...(x.a ?? []), ...(x.order ?? []).map(o => o.expr)]) {
      if (!part) continue;
      for (const id of ir.freeRows(part)) if (id !== x.row.id) return null;
    }
    const keys = new Set(), rest = [], guards = [];
    for (const f of S.ctx.filters) {
      if (idle(f)) continue;
      if (f.kind === 'bind' && f.val.k === 'col' && f.val.row === this.keyRow) {
        const c = f.cols[0];
        const ref = typeof f.val.ref === 'number' ? f.val.ref : this.keyRow.cols.findIndex(k => k.lineage === f.val.ref);
        if (ref < 0 || !this.active.includes(ref)) return null;
        if (exp.has(c.table.name)) keys.add(ref);
        // A key whose filter reaches the scan over a relationship that filters back: not fused.
        else if (lw.model.reaches(c.table, S.table, state)) return null;
        else continue;
        // A guarded key (a value of the group, when a condition on the group holds): the
        // condition is the group's, read where the group is.
        if (f.guard && !guards.includes(f.guard)) guards.push(f.guard);
        continue;
      }
      rest.push(f);
    }
    // The other filters read no row, or only keys the scan is filtered to: those are its own
    // columns, row by row. A table filter on one column of the scan's that reads keys the scan is
    // not filtered to (time intelligence: the dates of the group's period, its dates a year
    // before) is a mapping of (keys, value) instead, joined to the scan.
    let readsKeys = false;
    const mapped = [];
    for (const f of rest) {
      const free = reads(f);
      for (const id of free) if (id !== kid) return null;
      if (!free.size) continue;
      const refs = [...ir.rowRefs(f, kid)];
      if (refs.every(i => keys.has(i))) { readsKeys = true; continue; }
      // The column the mapping is on: the filter's one column, or the key of the one table whose
      // columns it holds (FILTER(ALL('Date'), ...): the key says which row).
      const T = f.cols[0]?.table;
      const c = f.cols.length === 1 ? f.cols[0] : f.cols.every(y => y.table === T) && T.key && f.cols.includes(T.key) ? T.key : null;
      if (f.kind !== 'rel' || !c || !NULL_EMPTY.has(x.fn) || !exp.has(c.table.name)
        || refs.some(i => !this.keyCols[i]?.table || !this.active.includes(i))) return null;
      mapped.push({ f, refs, c });
    }
    const kept = rest.filter(f => !mapped.some(m => m.f === f));
    const block = lw.isolated(() => lw.scanBlock(S.table, new Ctx(kept, S.ctx.mods), new Map(), null, readsKeys ? [this.keyRow, this.keyCols] : null));
    const keyExpr = new Map();
    for (const { f, refs, c } of mapped) {
      const m = this.mapping(f, refs, c, state);
      if (!m) return null;
      const here = lw.isolated(() => block.res.meta(c));
      // A key the scan is grouped by already is the mapping's too: the same value. One it is
      // not grouped by is the mapping's.
      const on = [mayHoldNull(c) ? P.key(m.v, here) : P.eq(m.v, here)];
      refs.forEach((i, j) => {
        if (keys.has(i)) on.push(P.key(m.k[j], keyExpr.get(i) ?? lw.isolated(() => block.res.meta(this.keyCols[i]))));
        else { keys.add(i); keyExpr.set(i, m.k[j]); }
      });
      block.joins.push({ kind: 'inner', rel: m.rel, on: P.and(on) });
    }
    const keyList = [...keys].sort((a, b) => a - b);
    const keyExprs = lw.isolated(() => keyList.map(i => keyExpr.get(i) ?? block.res.meta(this.keyCols[i])));
    const c = canon(block.body(), true);
    const sig = `${S.table.name}|${state.key}|${keyList.join(',')}|${keyExprs.map(e => text(e, c.ids)).join(',')}|${c.key}`;
    let g = this.groups.find(y => y.sig === sig);
    if (!g) {
      g = { sig, block, keys: keyList, keyExprs, aggs: [] };
      this.groups.push(g);
    }
    const parts = lw.isolated(() => lw.aggParts(x, withRow(new Map(), x.row, g.block.res), g.block));
    const M = new Map(), T = e => (e ? text(e, M) : '');
    const e = parts.extra ?? {};
    const key = [parts.fn, T(parts.arg), e.t, e.exact, e.text, T(e.delim), T(e.k), (e.order ?? []).map(o => `${T(o.expr)} ${o.desc}`).join(',')].join('|');
    let a = g.aggs.find(y => y.key === key);
    if (!a) {
      a = { key, col: P.newCol(x.fn, x.t), fn: parts.fn, arg: parts.arg, extra: parts.extra };
      g.aggs.push(a);
    }
    const v = P.ref(a.col);
    if (!guards.length) return v;
    const test = P.and(guards.map(gd => lw.scalar(gd, scope, blk)));
    const zero = x.fn === 'count0' || x.fn === 'dcount0';
    return when([[test, v]], zero ? ir.lit(0, x.t) : ir.lit(null, x.t), x.t);
  }

  // The groups joined to the level's block kb (a key's value there: keyOf(i)).
  finish(kb, keyOf) {
    for (const g of this.groups) {
      const rel = P.aggregate(g.block.body(), g.keyExprs.map((e, j) => ({ name: `g${j}`, expr: e })),
        g.aggs.map(a => ({ col: a.col, fn: a.fn, arg: a.arg, extra: a.extra })));
      if (!g.keys.length) kb.joins.push({ kind: 'cross', rel, on: null });
      else kb.joins.push({ kind: 'left', rel, on: P.and(g.keys.map((ki, j) => P.key(P.ref(rel.keys[j].col), keyOf(ki)))) });
    }
  }
}

// The aggregates that are blank over no rows: one a mapping takes, by keys its rows have none
// of, is blank there as the aggregate over no rows is.
const NULL_EMPTY = new Set(['sum', 'avg', 'min', 'max', 'count', 'countrows', 'dcount', 'dcountnb', 'countblank', 'median', 'stdev_s', 'stdev_p', 'var_s', 'var_p']);
const mayHoldNull = c => !c.unique && c.nullable !== false;

// The columns a scalar reads (inside its EXISTS too), and whether it holds an EXISTS.
function scalarReads(x, out = { cols: new Set(), query: false }) {
  if (!x || typeof x !== 'object') return out;
  if (x.k === 'ref') out.cols.add(x.col);
  else if (x.k === 'exists') { out.query = true; free(x.rel).forEach(c => out.cols.add(c)); }
  else if (x.k === 'case') { x.w.forEach(([c, v]) => { scalarReads(c, out); scalarReads(v, out); }); scalarReads(x.e, out); }
  else if (Array.isArray(x.a)) x.a.forEach(y => scalarReads(y, out));
  return out;
}

// Whether an expression is blank whatever its rows (emit.js's support with nothing fused): a
// level of SUMMARIZECOLUMNS whose expressions all are has no group.
function blankOnly(x) {
  const all = xs => xs.every(blankOnly);
  switch (x.k) {
    case 'lit': return x.v === null;
    case 'op':
      if (x.op === 'add' || x.op === 'sub') return all(x.a);
      if (x.op === 'mul') return blankOnly(x.a[0]) || blankOnly(x.a[1]);
      if (x.op === 'div' || x.op === 'neg') return blankOnly(x.a[0]);
      return false;
    case 'fn':
      if (x.name === 'divide' || x.name === 'cydivide') return (x.a.length === 2 || (x.a[2].k === 'lit' && x.a[2].v === null)) && (blankOnly(x.a[0]) || blankOnly(x.a[1]));
      if (x.name === 'coalesce') return all(x.a);
      if (x.strict || x.name === 'cast') return blankOnly(x.a[0]);
      return false;
    case 'case': return all([...x.w.map(w => w[1]), x.e]);
    default: return false;
  }
}

// --- blocks and the columns of their rows ------------------------------------------------

class Block {
  constructor(lw, from, cols) {
    this.lw = lw;
    this.serial = Block.made = (Block.made ?? 0) + 1;   // blocks made later are inside those made before
    this.defDepth = lw.defDepth ?? 0;                    // the definitions it is lowered in
    this.rendered = false;
    this.from = from;          // a relation, or null: one row
    this.cols = cols;          // the table's columns: [{ name, lineage, t }]
    this.joins = [];           // [{ kind, rel, on }]
    this.applies = [];         // [{ rel, outer }]
    this.where = [];
    this.distinct = false;
    this.qualify = null;       // TOPN: { order, n }
    this.out = null;           // [{ expr, name, lineage, t }], or null: the input row's columns
    this.open = true;          // conditions and the output can still be written over the input row
    this.plain = true;         // the output is the input row
    this.res = null;
  }
  outList() {
    if (this.out) return this.out;
    return this.cols.map((c, i) => ({ expr: this.res.col(i), name: c.name, lineage: c.lineage ?? null, t: c.t }));
  }
  setOut(cols, exprs) {
    this.cols = cols;
    this.out = exprs.map((expr, i) => ({ expr, name: cols[i]?.name ?? `c${i}`, lineage: cols[i]?.lineage ?? null, t: cols[i]?.t ?? expr.t }));
    this.plain = false;
  }
  // The input row: from, its joins and applies, its conditions.
  body() {
    let r = this.from ?? P.oneRow();
    for (const j of this.joins) r = P.join(j.kind, r, j.rel, j.on);
    for (const a of this.applies) r = P.apply(r, a.rel, a.outer);
    if (this.where.length) r = P.select(r, P.and(this.where));
    return r;
  }
  render() {
    this.rendered = true;
    const list = this.outList();   // first: a column of a related table joins it
    let r = this.body();
    if (this.qualify) {
      r = P.window(r, [], [{ name: 'rank', fn: 'rank', order: this.qualify.order }]);
      r = P.select(r, P.cmp('le', P.ref(r.fns[0].col), this.qualify.n));
    }
    const refs = list.every(o => o.expr.k === 'ref' && r.cols.includes(o.expr.col));
    if (refs && !this.distinct) return { rel: r, list };
    r = P.project(r, list.map(o => ({ name: o.name, expr: o.expr, lineage: o.lineage, t: o.t })));
    if (this.distinct) r = P.distinct(r);
    return { rel: r, list: r.cols.map((c, i) => ({ expr: P.ref(c), name: list[i].name, lineage: list[i].lineage })) };
  }
}

const colOf = (rel, m) => {
  const c = rel.cols.find(x => x.lineage === m);
  if (!c) throw new Error(`plan: '${m.table.name}'[${m.name}] is not a column of the relation`);
  return c;
};

// The columns of a row, and joins of related tables into its block to reach theirs.
class Res {
  constructor(lw, block, state) {
    this.lw = lw;
    this.block = block;
    this.state = state;
    this.joinRel = new Map();
    this.joinKey = new Map();
  }
  meta(m) {
    const own = this.own(m);
    if (own != null) return own;
    for (const t of this.anchors()) {
      const path = this.lw.model.expand(t, this.state, null, true).get(m.table.name);
      if (path?.length && this.own(path[0].from) != null) return this.via(path, m);
    }
    throw semantic(`'${m.table.name}'[${m.name}] cannot be reached from this row`);
  }
  // Through the joins of `path` to column m of its last table; a foreign key stands for the key
  // it references when the relationship relies on referential integrity.
  via(path, m) {
    const last = path.at(-1);
    if (last.to === m && (last.rel.ri || this.lw.options.assumeIntegrity) && last.rel.to === m)
      return path.length === 1 ? this.own(last.from) : this.via(path.slice(0, -1), last.from);
    return this.physical(this.join(path), m);
  }
  join(path) {
    const key = path.map(h => `${h.rel.name}${h.from === h.rel.from ? '>' : '<'}`).join('/');
    const seen = this.joinRel.get(key);
    if (seen) return seen;
    const from = path.length === 1 ? this.own(path[0].from) : this.physical(this.join(path.slice(0, -1)), path.at(-1).from);
    const hop = path.at(-1);
    if (!this.block) throw semantic(`'${hop.to.table.name}' cannot be joined here`);
    const rel = this.lw.source(hop.to.table);
    const to = P.ref(colOf(rel, hop.to));
    this.block.joins.push({ kind: 'left', rel, on: P.eq(to, from) });
    this.joinRel.set(key, rel);
    this.joinKey.set(rel, to);
    return rel;
  }
  physical(rel, m) {
    if (!m.expr) return P.ref(colOf(rel, m));
    // A calculated column: its expression on this row, in an empty filter context and without
    // row-level security (one the query defines: under it). Blank where a join found no row.
    const { row, expr } = this.lw.options.calcColumn(m);
    const res = new ScanRes(this.lw, this.block, m.table, rel, this.state);
    const busy = this.lw.calcBusy;
    if (busy.has(m)) throw semantic(`calculated column '${m.table.name}'[${m.name}] depends on itself`);
    busy.add(m);
    let v;
    const value = () => this.lw.scalar(expr, new Map([[row.id, res]]), this.block);
    try { v = m.query ? value() : this.lw.unsecured(value); } finally { busy.delete(m); }
    const key = this.joinKey.get(rel);
    return key ? { k: 'case', w: [[P.notNull(key), v]], e: ir.lit(null, v.t), t: v.t, nn: false } : v;
  }
}

class ScanRes extends Res {
  constructor(lw, block, table, rel, state) {
    super(lw, block, state);
    this.table = table;
    this.rel = rel;
  }
  own(m) { return m.table === this.table ? this.physical(this.rel, m) : null; }
  anchors() { return [this.table]; }
  col(ref) { return this.meta(typeof ref === 'number' ? this.table.columns[ref] : ref); }
  get list() { return this.table.columns.map(c => ({ expr: this.meta(c), lineage: c, name: c.name })); }
}

class WrapRes extends Res {
  constructor(lw, block, list, state) {
    super(lw, block, state);
    this.list = list;   // [{ expr, lineage, name }]
  }
  own(m) { return this.list.find(c => c.lineage === m)?.expr ?? null; }
  anchors() { return [...new Set(this.list.filter(c => c.lineage).map(c => c.lineage.table))]; }
  col(ref) {
    if (typeof ref === 'number') {
      if (!this.list[ref]) throw new Error(`plan: no column ${ref}`);
      return this.list[ref].expr;
    }
    return this.meta(ref);
  }
}
