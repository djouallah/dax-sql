// A query plan (plan.js) -> one dialect's SQL. Every relation is a SELECT whose columns are
// named by their ids (_c<id>), unique in the query, so a column is read by its name wherever it
// is: in the SELECT over its relation, or in a subquery correlated to it. The plan's scalars
// are written as the emitter writes them (its scalar writer, with DAX's rules for blanks); the
// rest through the dialect's methods. No rewrite: the SQL says what the plan says.
import { Emitter, orderTerm } from './emit.js';

const EMPTY = new Map();
const MANY = 'A table of multiple values was supplied where a single value was expected.';

export class PlanSql extends Emitter {
  constructor(model, dialect, options = {}) {
    super(model, dialect, { ...options, optimize: false });
  }

  cn(c) { return `_c${c.id}`; }

  query({ plan: root }) {
    this.defs = new Map();
    for (const d of root.defs) this.defs.set(d, { name: this.alias('v'), sql: this.rel(d.rel) });
    const a = this.alias('q');
    const items = root.items.map(i => {
      let s = this.scalar(i.expr, EMPTY);
      if (i.by) s = i.by(s);
      else if (i.cast) s = this.d.cast(s, i.cast);
      return `${s} AS ${this.ident(i.name)}`;
    });
    let sql = `SELECT ${items.join(', ') || '1 AS one'} FROM (${this.rel(root.src)}) AS ${a}`;
    if (root.order.length) sql += ` ORDER BY ${root.order.map(o => this.orderBy(this.scalar(o.expr, EMPTY), o.desc)).join(', ')}`;
    if (root.limit) sql += this.d.limit(root.limit.n, root.limit.offset, root.order.length > 0);
    // The definitions, each evaluated once.
    if (this.defs.size) sql = `WITH ${[...this.defs.values()].map(d => `${d.name} AS ${this.d.materialized}(${d.sql})`).join(',\n')}\n${sql}`;
    return this.d.finish(sql);
  }

  // A relation: a SELECT of its columns.
  rel(r) {
    const cn = c => this.cn(c);
    const from = (x, p = 's') => { const a = this.alias(p); return `(${this.rel(x)}) AS ${a}`; };
    switch (r.k) {
      case 'scan': {
        const a = this.alias('t');
        return `SELECT ${r.cols.map(c => `${a}.${this.ident(c.lineage.source)} AS ${cn(c)}`).join(', ')} FROM ${this.source(r.table)} AS ${a}`;
      }
      case 'values': {
        if (!r.rows.length) return `SELECT ${r.cols.map(c => `${this.d.nullOf(c.t)} AS ${cn(c)}`).join(', ')} WHERE ${this.d.never}`;
        return r.rows.map(row => `SELECT ${row.map((v, i) => `${this.val(v, r.cols[i])} AS ${cn(r.cols[i])}`).join(', ')}`).join(' UNION ALL ');
      }
      case 'select': return `SELECT * FROM ${from(r.src)} WHERE ${this.scalar(r.pred, EMPTY, true)}`;
      case 'project': {
        const items = r.items.map(i => `${this.val(i.expr, i.col)} AS ${cn(i.col)}`);
        return `SELECT ${items.length ? items.join(', ') : `1 AS ${this.alias('_e')}`} FROM ${from(r.src)}`;
      }
      case 'distinct': return `SELECT DISTINCT * FROM ${from(r.src)}`;
      case 'aggregate': {
        const keys = r.keys.map(k => this.scalar(k.expr, EMPTY));
        const sel = [...keys.map((k, i) => `${k} AS ${cn(r.keys[i].col)}`), ...r.aggs.map(a => `${this.aggSql(a)} AS ${cn(a.col)}`)];
        return `SELECT ${sel.join(', ')} FROM ${from(r.src)}${keys.length ? ` GROUP BY ${keys.join(', ')}` : ''}`;
      }
      case 'join': {
        const l = from(r.left, 'l'), rt = from(r.right, 'r');
        if (r.kind === 'cross') return `SELECT * FROM ${l} CROSS JOIN ${rt}`;
        return `SELECT * FROM ${l} ${r.kind === 'left' ? 'LEFT JOIN' : 'JOIN'} ${rt} ON ${this.scalar(r.on, EMPTY, true)}`;
      }
      case 'apply': return `SELECT * FROM ${from(r.left, 'l')}${this.d.lateral(this.rel(r.right), this.alias('a'), r.outer)}`;
      case 'union': return r.srcs.map(s => `SELECT ${s.cols.map((c, i) => `${cn(c)} AS ${cn(r.cols[i])}`).join(', ')} FROM ${from(s, 'u')}`).join(' UNION ALL ');
      case 'window': {
        const part = r.part.length ? `PARTITION BY ${r.part.map(p => this.scalar(p, EMPTY)).join(', ')}` : '';
        const fns = r.fns.map(f => {
          const call = { row_number: 'ROW_NUMBER()', rank: 'RANK()', dense_rank: 'DENSE_RANK()', count: 'COUNT(*)' }[f.fn];
          const over = [part, this.d.windowOrder(f.order.map(o => this.term(o)))].filter(Boolean).join(' ');
          return `${call} OVER (${over}) AS ${cn(f.col)}`;
        });
        return `SELECT *, ${fns.join(', ')} FROM ${from(r.src)}`;
      }
      case 'series': {
        const g = this.alias('g');
        return `SELECT ${g}.v AS ${cn(r.cols[0])} FROM ${this.d.series(this.scalar(r.start, EMPTY), this.scalar(r.end, EMPTY), this.scalar(r.step, EMPTY), r.t)} AS ${g}`;
      }
      case 'shared': {
        const d = this.defs.get(r.def);
        return `SELECT ${r.def.rel.cols.map((c, i) => `${cn(c)} AS ${cn(r.cols[i])}`).join(', ')} FROM ${d.name}`;
      }
      case 'paths': {
        const [k, p] = r.src.cols, name = this.alias('pt'), h = this.alias('h');
        const edges = `SELECT ${cn(k)} AS k, ${cn(p)} AS p FROM ${from(r.src)}`;
        return `SELECT ${h}.${this.ident('key')} AS ${cn(r.cols[0])}, ${h}.${this.ident('path')} AS ${cn(r.cols[1])} FROM (${this.d.paths(edges, r.keyType, name)}) AS ${h}`;
      }
    }
    throw new Error(`plan-sql: relation ${r.k}`);
  }

  // An order term of a window.
  term(o) {
    const v = this.scalar(o.expr, EMPTY);
    if (o.mode === 'term') return orderTerm(this.d, v, o);
    if (o.mode === 'plain') return this.d.order(v, 'ASC', 'FIRST');
    return this.orderBy(v, o.desc);
  }

  aggSql({ fn, arg, extra }) {
    const x = arg ? this.scalar(arg, EMPTY) : null;
    // A value of a table of one row (a scalar subquery's): an error over more.
    if (fn === 'single') return `CASE WHEN COUNT(*) > 1 THEN ${this.d.fn('error', [this.d.str(MANY)], [])} ELSE MIN(${x}) END`;
    // The one value of its rows, or none.
    if (fn === 'onlyone') return `CASE WHEN COUNT(*) = 1 THEN MIN(${x}) END`;
    const e = { t: extra.t, ...(extra.exact ? { exact: true } : {}) };
    if (extra.delim) e.delim = this.scalar(extra.delim, EMPTY);
    if (extra.order) e.order = extra.order.map(o => this.orderBy(this.scalar(o.expr, EMPTY), o.desc));
    if (extra.k) e.k = this.scalar(extra.k, EMPTY);
    return this.d.agg(fn, fn === 'concat' ? this.d.text(x, extra.text) : x, e);
  }

  // A value as a column of type col.t: a blank typed as its column (a UNION reads it).
  val(v, col) { return v.k === 'lit' && v.v === null ? this.d.nullOf(col.t) : this.scalar(v, EMPTY); }

  // --- the plan's own scalars ----------------------------------------------------------------

  scalar(x, scope = EMPTY, pred = false) {
    if (x.k === 'sql') {
      const s = x.write(this.d, x.a.map(a => this.scalar(a, scope)), this);
      return this.d.boolValues || !x.cond || pred ? s : this.d.value(s);
    }
    return super.scalar(x, scope, pred);
  }
  scalarOf(x, scope, pred) {
    if (x.k === 'ref') return this.cn(x.col);
    if (x.k === 'exists') return `EXISTS (${this.rel(x.rel)})`;
    return super.scalarOf(x, scope, pred);
  }
  // A whole-number column in arithmetic as 64 bits, as the emitter writes one.
  num(v, scope) {
    if (v.k === 'ref' && v.t === 'int') return this.d.cast(this.scalar(v, scope), 'int');
    return super.num(v, scope);
  }
}
