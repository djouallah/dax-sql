// A query plan (plan.js) -> one dialect's SQL. Every relation is a SELECT whose columns are
// named by their ids (_c<id>), unique in the query, so a column is read by its name wherever it
// is: in the SELECT over its relation, or in a subquery correlated to it. The plan's scalars
// are written as the emitter writes them (its scalar writer, with DAX's rules for blanks); the
// rest through the dialect's methods. No rewrite: the SQL says what the plan says.
import { Emitter, orderTerm } from './emit.js';
import { isCondOp } from './plan.js';
import { refsOf } from './passes/decorrelate.js';

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
    // What a SELECT reads x from: a join's FROM, a filter's WHERE, in the SELECT itself (not a
    // SELECT * around them).
    const body = x => {
      if (x.k === 'join') {
        const l = from(x.left, 'l'), rt = from(x.right, 'r');
        return { from: x.kind === 'cross' ? `${l} CROSS JOIN ${rt}` : `${l} ${x.kind === 'left' ? 'LEFT JOIN' : 'JOIN'} ${rt} ON ${this.on(x)}`, where: [] };
      }
      if (x.k === 'select') { const b = body(x.src); return { from: b.from, where: [...b.where, this.scalar(x.pred, EMPTY, true)] }; }
      return { from: from(x), where: [] };
    };
    const read = x => { const b = body(x); return `${b.from}${b.where.length ? ` WHERE ${b.where.join(' AND ')}` : ''}`; };
    switch (r.k) {
      case 'scan': {
        const a = this.alias('t');
        return `SELECT ${r.cols.map(c => `${a}.${this.ident(c.lineage.source)} AS ${cn(c)}`).join(', ')} FROM ${this.source(r.table)} AS ${a}`;
      }
      case 'values': {
        if (!r.rows.length) return `SELECT ${r.cols.map(c => `${this.d.nullOf(c.t)} AS ${cn(c)}`).join(', ')} WHERE ${this.d.never}`;
        return r.rows.map(row => `SELECT ${row.map((v, i) => `${this.val(v, r.cols[i])} AS ${cn(r.cols[i])}`).join(', ')}`).join(' UNION ALL ');
      }
      case 'select': return `SELECT * FROM ${read(r)}`;
      case 'project': {
        const items = r.items.map(i => `${this.val(i.expr, i.col)} AS ${cn(i.col)}`);
        return `SELECT ${items.length ? items.join(', ') : `1 AS ${this.alias('_e')}`} FROM ${read(r.src)}`;
      }
      case 'distinct': {
        // Over a projection: SELECT DISTINCT of its values.
        if (r.src.k === 'project' && r.src.items.length) return `SELECT DISTINCT ${r.src.items.map(i => `${this.val(i.expr, i.col)} AS ${cn(i.col)}`).join(', ')} FROM ${read(r.src.src)}`;
        return `SELECT DISTINCT * FROM ${read(r.src)}`;
      }
      case 'aggregate': {
        const keys = r.keys.map(k => this.scalar(k.expr, EMPTY));
        const sel = [...keys.map((k, i) => `${k} AS ${cn(r.keys[i].col)}`), ...r.aggs.map(a => `${this.aggSql(a)} AS ${cn(a.col)}`)];
        return `SELECT ${sel.join(', ')} FROM ${read(r.src)}${keys.length ? ` GROUP BY ${keys.join(', ')}` : ''}`;
      }
      case 'join': return `SELECT * FROM ${read(r)}`;
      case 'apply': return `SELECT * FROM ${from(r.left, 'l')}${this.d.lateral(this.rel(r.right), this.alias('a'), r.outer)}`;
      case 'union': return r.srcs.map((s, k) => `SELECT ${r.picks[k].map((c, i) => `${c.t === 'blank' && r.cols[i].t !== 'blank' ? this.d.nullOf(r.cols[i].t) : cn(c)} AS ${cn(r.cols[i])}`).join(', ')} FROM ${from(s, 'u')}`).join(' UNION ALL ');
      case 'window': {
        const part = r.part.length ? `PARTITION BY ${r.part.map(p => this.scalar(p, EMPTY)).join(', ')}` : '';
        const fns = r.fns.map(f => {
          const call = { row_number: 'ROW_NUMBER()', rank: 'RANK()', dense_rank: 'DENSE_RANK()', count: 'COUNT(*)' }[f.fn];
          const over = [part, this.d.windowOrder(f.order.map(o => this.term(o)))].filter(Boolean).join(' ');
          return `${call} OVER (${over}) AS ${cn(f.col)}`;
        });
        return `SELECT *, ${fns.join(', ')} FROM ${read(r.src)}`;
      }
      case 'series': {
        const g = this.alias('g');
        const rows = this.d.series(this.scalar(r.start, EMPTY), this.scalar(r.end, EMPTY), this.scalar(r.step, EMPTY), r.t);
        if (!r.src) return `SELECT ${g}.v AS ${cn(r.cols[0])} FROM ${rows} AS ${g}`;
        // Bounds read off the one row of src: the series for that row.
        return `SELECT ${g}.v AS ${cn(r.cols[0])} FROM ${from(r.src)}${this.d.lateral(`SELECT * FROM ${rows} AS ${this.alias('g')}`, g, false)}`;
      }
      case 'shared': {
        const d = this.defs.get(r.def);
        return `SELECT ${r.picks.map((c, i) => `${cn(c)} AS ${cn(r.cols[i])}`).join(', ')} FROM ${d.name}`;
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
    // The standard aggregates, under the names the dialect knows them by.
    if (fn === 'count_star') return 'COUNT(*)';
    if (fn === 'count_values') return this.d.agg('count0', x, {});
    if (fn === 'count_distinct') return this.d.agg('dcount0', x, {});
    if (fn === 'string_agg') fn = 'concat';
    const e = { t: extra.t, ...(extra.exact ? { exact: true } : {}) };
    if (extra.delim) e.delim = this.scalar(extra.delim, EMPTY);
    if (extra.order) e.order = extra.order.map(o => this.orderBy(this.scalar(o.expr, EMPTY), o.desc));
    if (extra.k) e.k = this.scalar(extra.k, EMPTY);
    return this.d.agg(fn, fn === 'concat' ? this.d.text(x, extra.text) : x, e);
  }

  // A value as a column of type col.t: a blank typed as its column (a UNION reads it).
  val(v, col) { return v.k === 'lit' && v.v === null ? this.d.nullOf(col.t) : this.scalar(v, EMPTY); }

  // A join's condition. Its blank-safe keys, each a value of the left's columns and one of the
  // right's, as one where the dialect has it (Postgres estimates each key's matches apart: a join
  // of several keys for a row or so, and loops over thousands).
  on(r) {
    if (!this.d.keysTogether) return this.scalar(r.on, EMPTY, true);
    const cs = [], flat = c => (c.k === 'pop' && c.op === 'and' ? c.a.forEach(flat) : cs.push(c));
    flat(r.on);
    const L = new Set(r.left.cols), R = new Set(r.right.cols);
    const within = (x, side) => { const f = refsOf(x); return f.size > 0 && [...f].every(c => side.has(c)); };
    const keys = [];
    for (const c of cs) {
      if (c.k !== 'pop' || c.op !== 'key' || !this.d.keyType(c.a[0].t)) continue;
      const [x, y] = c.a;
      if (within(x, L) && within(y, R)) keys.push({ c, l: x, r: y });
      else if (within(y, L) && within(x, R)) keys.push({ c, l: y, r: x });
    }
    if (keys.length < 2) return this.scalar(r.on, EMPTY, true);
    const together = this.d.keysTogether(keys.map(k => ({ a: this.scalar(k.l, EMPTY), b: this.scalar(k.r, EMPTY), t: k.c.a[0].t })));
    const used = new Set(keys.map(k => k.c));
    return `(${[together, ...cs.filter(c => !used.has(c)).map(c => this.scalar(c, EMPTY, true))].join(' AND ')})`;
  }

  // --- the plan's own scalars ----------------------------------------------------------------

  scalar(x, scope = EMPTY, pred = false) {
    if (x.k === 'pop') {
      // The conditions of AND, OR and NOT as conditions; the others' arguments as values.
      const logic = x.op === 'and' || x.op === 'or' || x.op === 'not';
      const A = x.a.map(v => this.scalar(v, scope, logic));
      const [a, b] = A;
      const s = {
        eq: () => `(${a} = ${b})`, ne: () => `(${a} <> ${b})`, key: () => this.d.isNotDistinct(a, b, x.a[0].t),
        isnull: () => `(${a} IS NULL)`, notnull: () => `(${a} IS NOT NULL)`,
        lt: () => `(${a} < ${b})`, le: () => `(${a} <= ${b})`, gt: () => `(${a} > ${b})`, ge: () => `(${a} >= ${b})`,
        and: () => `(${a} AND ${b})`, or: () => `(${a} OR ${b})`, not: () => `(NOT ${a})`,
        in: () => `(${a} IN (${A.slice(1).join(', ')}))`,
        add: () => `(${a} + ${b})`, sub: () => `(${a} - ${b})`, mul: () => `(${a} * ${b})`, div: () => this.d.div(a, b), neg: () => `(-${a})`,
        coalesce: () => `COALESCE(${A.join(', ')})`, nullif: () => `NULLIF(${a}, ${b})`,
        cast: () => this.d.cast(a, x.to), concat: () => this.d.concat(a, b),
        call: () => this.call(x.name, A, x.a),
        true: () => this.d.always, false: () => this.d.never,
      }[x.op]();
      return this.d.boolValues || !isCondOp(x.op) || pred ? s : this.d.value(s);
    }
    return super.scalar(x, scope, pred);
  }

  // A standard function, as the dialect writes it.
  call(name, a, nodes) {
    const d = this.d, [x, y, z] = a, pg = d.name === 'postgres', ts = d.name === 'tsql';
    switch (name) {
      case 'strpos': return ts ? `CHARINDEX(${y}, ${x})` : pg ? `strpos(${x}, ${y})` : `instr(${x}, ${y})`;
      case 'substring_from': return ts ? `SUBSTRING(${x}, ${y}, LEN(${x}))` : `substring(${x}, ${y})`;
      case 'regexp_replace': return `regexp_replace(${x}, ${y}, ${z}, 'g')`;
      case 'code_point': return ts ? `UNICODE(${x})` : pg ? `ascii(${x})` : `unicode(${x})`;
      case 'extract_dow': return ts ? `(DATEPART(weekday, ${x}) - 1)` : pg ? `CAST(EXTRACT(DOW FROM ${x}) AS BIGINT)` : `dayofweek(${x})`;
      case 'make_date': return ts ? `DATEFROMPARTS(${a.join(', ')})` : pg ? `make_date(${a.map(v => `CAST(${v} AS INTEGER)`).join(', ')})` : `make_date(${a.join(', ')})`;
      case 'ceil': return ts ? `CEILING(${x})` : `ceil(${x})`;
      case 'replace': return `replace(${x}, ${y}, ${z})`;
      case 'split_part': return pg ? `split_part(${x}, ${y}, CAST(${z} AS INTEGER))` : `split_part(${x}, ${y}, ${z})`;
      case 'date_diff_microsecond': return ts ? `DATEDIFF_BIG(microsecond, ${x}, ${y})` : pg ? `CAST(EXTRACT(EPOCH FROM (${y} - ${x})) * 1000000 AS BIGINT)` : `date_diff('microsecond', ${x}, ${y})`;
      case 'add_microseconds': return ts ? `DATEADD(microsecond, ${y}, ${x})` : pg ? `(${x} + ${y} * INTERVAL '1 microsecond')` : `(${x} + to_microseconds(${y}))`;
    }
    const m = /^(extract|date_trunc|date_diff)_(\w+)$/.exec(name);
    if (m?.[1] === 'extract') return d.fn(m[2], [x], nodes);
    if (m?.[1] === 'date_trunc') return d.fn('start_of', [x, d.str(m[2])], nodes);
    if (m?.[1] === 'date_diff') return d.fn('datediff', [x, y, d.str(m[2])], nodes);
    switch (name) {
      case 'add_days': return d.fn('add_interval', [x, y, d.str('day')], nodes);
      case 'add_months': return d.fn('add_interval', [x, y, d.str('month')], nodes);
      case 'length': return d.fn('len', a, nodes);
      case 'substring': return d.fn('mid', a, nodes);
      case 'trim': return d.fn('trim_ends', a, nodes);
      case 'contains': return d.fn('containsstringexact', a, nodes);
      case 'mod': return `(${x} % ${y})`;
      // Whole-number division.
      case 'idiv': return d.name === 'duckdb' ? `(${x} // ${y})` : d.name === 'postgres' ? `div(${x}, ${y})` : `(${x} / ${y})`;
      case 'trunc': return `trunc(${x})`;
      case 'floor': return `floor(${x})`;
      // As DAX writes a value as text, a text's n-th occurrence replaced, text read as a date.
      case 'to_text': return d.text(x, nodes[0].t);
      case 'replace_nth': return d.fn('substitute', a, nodes);
      case 'parse_datetime': return d.fn('cast', [x, "'datetime'"], nodes);
    }
    return d.fn(name, a, nodes);
  }
  scalarOf(x, scope, pred) {
    if (x.k === 'ref') return this.cn(x.col);
    if (x.k === 'exists') return `EXISTS (${this.rel(x.rel)})`;
    // A number in its exact digits (a decimal no double holds).
    if (x.k === 'lit' && x.digits) return x.v;
    return super.scalarOf(x, scope, pred);
  }
  // A whole-number column in arithmetic as 64 bits, as the emitter writes one.
  num(v, scope) {
    if (v.k === 'ref' && v.t === 'int') return this.d.cast(this.scalar(v, scope), 'int');
    return super.num(v, scope);
  }
}
