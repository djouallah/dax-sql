// A query plan (plan.js) -> one dialect's SQL. Every relation is a SELECT whose columns are
// named by their ids (_c<id>), unique in the query, so a column is read by its name wherever it
// is: in the SELECT over its relation, or in a subquery correlated to it. The plan's scalars
// are written as the emitter writes them (its scalar writer, with DAX's rules for blanks); the
// rest through the dialect's methods. No rewrite: the SQL says what the plan says.
import { Emitter, orderTerm } from './emit.js';
import * as P from './plan.js';
import { isCondOp } from './plan.js';
import { free, refsOf } from './passes/decorrelate.js';

const EMPTY = new Map();
const MANY = 'A table of multiple values was supplied where a single value was expected.';

export class PlanSql extends Emitter {
  constructor(model, dialect, options = {}) {
    super(model, dialect, { ...options, optimize: false });
  }

  // A column's name: numbered in the query in the order its columns are first written, so that
  // a query's SQL is the same each time it is compiled (the plan's ids are the process's).
  cn(c) {
    this.names ??= new Map();
    let n = this.names.get(c.id);
    if (n == null) this.names.set(c.id, n = this.names.size + 1);
    return `_c${n}`;
  }

  query({ plan: root }) {
    this.defs = new Map();
    // The WITH's relations in order, each after those it reads: the definitions and (a dialect
    // whose parser nests subqueries only so deep: Polars) each relation a SELECT reads.
    this.ctes = [];
    for (const d of root.defs) {
      const e = { name: this.alias('v') };
      this.defs.set(d, e);
      e.sql = this.rel(d.rel);
      this.ctes.push(e);
    }
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
    // The definitions, each evaluated once. The same as its CTEs and the SELECT that reads them
    // (parts), for an engine that cannot nest a WITH (compileStatement lifts them).
    const ctes = this.ctes.map(d => `${d.name} AS ${this.d.materialized}(${d.sql})`);
    this.parts = { ctes: ctes.map(c => this.d.finish(c)), body: this.d.finish(sql) };
    if (ctes.length) sql = `WITH ${ctes.join(',\n')}\n${sql}`;
    return this.d.finish(sql);
  }

  // A relation: a SELECT of its columns.
  rel(r) {
    const cn = c => this.cn(c);
    const from = (x, p = 's') => {
      const a = this.alias(p);
      // A relation that reads an outer row (in a correlated subquery) stays where it is: a CTE
      // sees no outer row.
      if (!this.d.flatSql || free(x).size) return `(${this.rel(x)}) AS ${a}`;
      const e = { name: this.alias('w'), sql: this.rel(x) };
      this.ctes.push(e);
      return `${e.name} AS ${a}`;
    };
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
      case 'apply': {
        // A value for each row of the left (one column of a grouping of no key: one row): a scalar
        // subquery reading the left's row, as the compiled SQL has it (an engine unnests one in a
        // value apart from a lateral join's: DuckDB's of a LASTNONBLANK took 522 million rows as a
        // lateral join, a million so). A table for each row: a lateral join.
        const one = x => (x.k === 'aggregate' && !x.keys.length) || (x.k === 'project' && one(x.src));
        if (one(r.right) && r.right.cols.length === 1) return `SELECT *, (${this.rel(r.right)}) AS ${cn(r.right.cols[0])} FROM ${from(r.left, 'l')}`;
        return `SELECT * FROM ${from(r.left, 'l')}${this.d.lateral(this.rel(r.right), this.alias('a'), r.outer)}`;
      }
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
        // An engine with no LATERAL (Polars): each bound a scalar subquery over the one row of src.
        if (r.src && this.d.seriesBoundsAsSubqueries) {
          const row = from(r.src), b = x => `(SELECT ${this.scalar(x, EMPTY)} FROM ${row})`;
          return `SELECT ${g}.v AS ${cn(r.cols[0])} FROM ${this.d.series(b(r.start), b(r.end), b(r.step), r.t)} AS ${g}`;
        }
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
    // A function defined as standard ones: the dialect's own of that name, else its body.
    if (x.k === 'pop' && x.op === 'defined') {
      if (!this.d.nativeFns?.has(x.name)) return this.scalar(x.a[x.argc], scope, pred);
      const args = x.a.slice(0, x.argc);
      const s = this.d.fn(x.name, args.map(v => this.scalar(v, scope)), args);
      // A condition (T-SQL's EXACT), where a condition is no value: a value where one is asked for.
      return x.t === 'bool' && !this.d.boolValues && !pred ? this.d.value(s) : s;
    }
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
        call: () => this.call(x.name, A, x.a, x.t),
        true: () => this.d.always, false: () => this.d.never,
      }[x.op]();
      if (this.d.boolValues) return s;
      // Where a condition is no value (T-SQL): a condition asked for as a value is one; a
      // boolean value (COALESCE of conditions, a CASE) asked for as a condition is one too.
      // (contains: the dialect's CONTAINSSTRING, a condition where there are no boolean values.)
      if (isCondOp(x.op) || (x.op === 'call' && x.name === 'contains')) return pred ? s : this.d.value(s);
      return pred && x.t === 'bool' ? this.d.cond(s) : s;
    }
    return super.scalar(x, scope, pred);
  }

  // A standard function, as the dialect writes it.
  call(name, a, nodes, t) {
    const d = this.d, [x, y, z] = a, df = d.name === 'datafusion', pg = d.name === 'postgres' || d.name === 'polars' || df, ts = d.name === 'tsql';
    // The last day of a month (EOMONTH, the end of a period: the month's start, q months on, a day
    // back) as DuckDB's last_day, which it pushes below a join as a condition on the column
    // (the month ends of SAMEPERIODLASTYEAR: 1.2 million rows tested after a join, 39 thousand so).
    if (name === 'add_days' && d.name === 'duckdb') {
      const [m, k] = nodes, call = (v, n) => v?.k === 'pop' && v.op === 'call' && v.name === n;
      if (k?.k === 'lit' && k.v === -1 && call(m, 'add_months') && call(m.a[0], 'date_trunc_month')) {
        const p = this.scalar(m.a[0].a[0], EMPTY), q = m.a[1];
        return q.k === 'lit' && q.v === 1 ? `last_day(${p})` : `last_day(${p} + to_months(CAST((${this.scalar(q, EMPTY)}) - 1 AS INTEGER)))`;
      }
    }
    switch (name) {
      // DAX's runtime error: the dialect's (of the value's type), or a blank where an engine
      // computes a CASE's branches no row takes (Polars, DataFusion: it would always fail).
      case 'error': return d.computesEveryBranch ? `CAST(NULL AS ${d.type(t)})` : d.err ? d.err(x, t) : d.fn('error', a, nodes);
      // (T-SQL: CHARINDEX finds no empty text, which is at 1.)
      case 'strpos': return ts ? `CASE WHEN DATALENGTH(${y}) = 0 THEN 1 ELSE CHARINDEX(${y}, ${x}) END` : pg ? `strpos(${x}, ${y})` : `instr(${x}, ${y})`;
      case 'substring_from': return ts ? `SUBSTRING(${x}, ${y}, LEN(${x}))` : d.name === 'postgres' ? `substr(${x}, CAST(${y} AS INTEGER))` : `substring(${x}, ${y})`;
      case 'regexp_replace': return `regexp_replace(${x}, ${y}, ${z}, 'g')`;
      case 'extract_dow': return ts ? `(DATEPART(weekday, ${x}) - 1)` : pg ? `CAST(EXTRACT(DOW FROM ${x}) AS BIGINT)` : `dayofweek(${x})`;
      case 'make_date': return ts ? `DATEFROMPARTS(${a.join(', ')})` : pg ? `make_date(${a.map(v => `CAST(${v} AS INTEGER)`).join(', ')})` : `make_date(${a.join(', ')})`;
      case 'ceil': return ts ? `CEILING(${x})` : `ceil(${x})`;
      case 'replace': return `replace(${x}, ${y}, ${z})`;
      // T-SQL: the n-th of STRING_SPLIT's parts by their ordinal (none past the last, as a blank).
      case 'split_part': return ts ? `(SELECT value FROM STRING_SPLIT(${x}, ${y}, 1) WHERE ordinal = ${z})`
        // DataFusion computes a CASE's branch no row takes too, and a position below 1 is an error.
        : df ? `split_part(${x}, ${y}, CAST(greatest(${z}, 1) AS INTEGER))` : pg ? `split_part(${x}, ${y}, CAST(${z} AS INTEGER))` : `split_part(${x}, ${y}, ${z})`;
      case 'date_diff_microsecond': return ts ? `DATEDIFF_BIG(microsecond, ${x}, ${y})` : d.name === 'polars' || df ? `CAST(round((EXTRACT(EPOCH FROM ${y}) - EXTRACT(EPOCH FROM ${x})) * 1000000) AS BIGINT)` : pg ? `CAST(EXTRACT(EPOCH FROM (${y} - ${x})) * 1000000 AS BIGINT)` : `date_diff('microsecond', ${x}, ${y})`;
      case 'add_microseconds': return ts ? `DATEADD(microsecond, ${y}, ${x})` : df ? `(CAST(${x} AS TIMESTAMP) + CAST(CONCAT(CAST(CAST(${y} AS BIGINT) AS VARCHAR), ' microseconds') AS INTERVAL))` : d.name === 'polars' ? `(CAST(${x} AS TIMESTAMP) + CAST(${y} AS BIGINT) * INTERVAL '1 microsecond')` : pg ? `(${x} + ${y} * INTERVAL '1 microsecond')` : `(${x} + to_microseconds(${y}))`;
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
      case 'idiv': return d.name === 'duckdb' ? `(${x} // ${y})` : df ? `(CAST(${x} AS BIGINT) / CAST(${y} AS BIGINT))` : pg ? `div(${x}, ${y})` : `(${x} / ${y})`;
      case 'trunc': return ts ? `ROUND(${x}, 0, 1)` : `trunc(${x})`;
      // A fixed decimal (CURRENCY) on T-SQL: rounded as a DECIMAL, not as the FLOAT's binary value
      // (1.0001 / 2.0, 0.50005, is 0.5001), as the compiled SQL rounds one.
      case 'round': if (ts && t === 'decimal') return `CAST(ROUND(CAST(${x} AS DECIMAL(38,12)), ${y}) AS DECIMAL(19,4))`; break;
      case 'floor': return `floor(${x})`;
    }
    return d.fn(name, a, nodes);
  }
  scalarOf(x, scope, pred) {
    if (x.k === 'ref') return this.cn(x.col);
    if (x.k === 'exists') {
      // A membership of one value no blank meets (lower.js's member): IN, which the engine reads
      // as a semi-join on the value (EXISTS correlated by it is unnested over every outer row).
      // Its rows' other conditions, on their own columns alone, are the subquery's WHERE.
      const r = x.rel;
      if (x.member && r.k === 'select') {
        const own = new Set(r.src.cols);
        const terms = [], flat = c => (c?.k === 'pop' && c.op === 'and' ? c.a.forEach(flat) : terms.push(c));
        flat(r.pred);
        const nested = e => !!e && typeof e === 'object' && (e.k === 'exists' || (e.a ?? []).some(nested) || (e.w ?? []).flat().some(nested) || nested(e.e));
        const ownOnly = e => !nested(e) && [...refsOf(e)].every(y => own.has(y));
        const at = terms.findIndex(c => c?.k === 'pop' && c.op === 'eq' && c.a[0].k === 'ref' && own.has(c.a[0].col) && ![...refsOf(c.a[1])].some(y => own.has(y)));
        const rest = terms.filter((_, i) => i !== at);
        if (at >= 0 && rest.every(ownOnly)) {
          const [col, v] = terms[at].a;
          const where = rest.length ? ` WHERE ${rest.map(c => this.scalar(c, EMPTY, true)).join(' AND ')}` : '';
          const s = `${this.scalar(v, EMPTY)} IN (SELECT ${this.cn(col.col)} FROM (${this.rel(r.src)}) AS ${this.alias('i')}${where})`;
          return pred ? `(${s})` : this.d.orFalse(s);
        }
      }
      return `EXISTS (${this.rel(x.rel)})`;
    }
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
