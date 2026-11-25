// What the SQL writer (plan-sql.js) asks of a SQL dialect. The base class writes ANSI SQL where there is one;
// a dialect overrides what its engine spells differently (see duckdb.js). To add an engine,
// extend this class and implement what throws here.
//
// fn(name, args) receives the names below (the `fn` nodes of ir.js), with args as SQL text:
//   logic     isblank coalesce greatest least divide iseven isodd error row
//   math      abs sign sqrt exp ln log log10 power mod quotient round roundup rounddown int trunc
//             ceiling floor mround fact even odd value cast currency
//             cydiv cydivide
//   text      left right mid len upper lower trim substitute replace search find rept exact
//             unichar unicode containsstring containsstringexact combinevalues format_date
//             format_number
//   dates     date time year month day hour minute second quarter weekday weeknum eomonth
//             add_interval datediff start_of end_of today now utctoday utcnow
//   paths     pathlength pathitem pathitemreverse pathcontains
// agg(fn, arg, extra) the aggregates of ir.js: sum avg min max count countrows dcount dcountnb
//   countblank product median pct_inc pct_exc pctx_inc pctx_exc stdev_s stdev_p var_s var_p concat
//   hasone count0 dcount0 sum_currency
import { DaxError } from '../errors.js';

export class Dialect {
  name = 'ansi';

  ident(name) { return `"${String(name).replace(/"/g, '""')}"`; }
  str(v) { return `'${String(v).replace(/'/g, "''")}'`; }
  num(v) {
    if (!Number.isFinite(v)) throw new DaxError(`DAX: a number past a double's range (${v}) is not supported`, { code: 'UNSUPPORTED' });
    return String(v);
  }
  bool(v) { return v ? 'TRUE' : 'FALSE'; }
  datetime(v) { return /\d:\d/.test(v) ? `TIMESTAMP ${this.str(v)}` : `DATE ${this.str(v)}`; }
  literal(v, t) {
    if (v === null) return 'NULL';
    if (t === 'datetime' || t === 'date') return this.datetime(v);
    if (typeof v === 'boolean') return this.bool(v);
    if (typeof v === 'number') return this.num(v);
    return this.str(v);
  }

  // The SQL type of a DAX type, for CAST.
  type(t) {
    return { int: 'BIGINT', double: 'DOUBLE PRECISION', decimal: 'DECIMAL(19,4)', string: 'VARCHAR', bool: 'BOOLEAN', datetime: 'TIMESTAMP' }[t];
  }
  cast(sql, t) { return `CAST(${sql} AS ${this.type(t)})`; }
  // A blank of type t where a column is one (a subtotal's key): NULL, which the engine types.
  nullOf() { return 'NULL'; }

  // a / b as a number with a fraction.
  div(a, b) { return `(CAST(${a} AS DOUBLE PRECISION) / ${b})`; }

  // a = b, a blank equal to a blank; t, where it is known, the DAX type both are of (a join's key).
  isNotDistinct(a, b) { return `${a} IS NOT DISTINCT FROM ${b}`; }

  // A query's LIMIT and OFFSET, after its ORDER BY.
  limit(n, offset) { return `${n != null ? ` LIMIT ${n}` : ''}${offset ? ` OFFSET ${offset}` : ''}`; }

  // body(...vals): SQL that names each of `vals` more than once. An engine that has no way to
  // name a value once (T-SQL) writes the ones that are more than a column or a constant once,
  // in a row the body reads; nested, they would grow the SQL at each level.
  bind(vals, body) { return body(...vals); }

  // A value as text, the way & joins it.
  text(sql, t) {
    if (t === 'string') return sql;
    if (t === 'bool') return `CASE ${sql} WHEN TRUE THEN 'TRUE' WHEN FALSE THEN 'FALSE' END`;
    return `CAST(${sql} AS VARCHAR)`;
  }

  // PATH over a parent-child table: from `edges` (a SELECT of columns k, the key, of type t,
  // and p, its parent), a row (key, path) per key whose chain of parents reaches a blank parent
  // within `levels` rows, its path the keys from there down joined by "|". No recursion: the
  // rows joined to themselves level by level (e0 the row, e1 its parent, ...). `name` prefixes
  // the names it declares.
  paths(edges, t, name, levels) {
    const e = i => `${name}_${i}`, q = n => this.ident(n);
    const rows = i => `(SELECT k, p FROM (${edges}) AS ${name}_x${i} WHERE k IS NOT NULL) AS ${e(i)}`;
    const L = [...Array(levels).keys()];
    // Halves, so that neither the condition nor the path nests `levels` deep.
    const tree = (xs, f) => (xs.length === 1 ? xs[0] : f(tree(xs.slice(0, xs.length >> 1), f), tree(xs.slice(xs.length >> 1), f)));
    const from = L.map(i => (i ? `LEFT JOIN ${rows(i)} ON ${e(i)}.k = ${e(i - 1)}.p` : rows(0))).join(' ');
    const root = tree(L.map(i => (i ? `(${e(i)}.k IS NOT NULL AND ${e(i)}.p IS NULL)` : `${e(0)}.p IS NULL`)), (a, b) => `(${a} OR ${b})`);
    const item = i => (i ? `CASE WHEN ${e(i)}.k IS NOT NULL THEN ${this.concat(this.text(`${e(i)}.k`, t), this.str('|'))} ELSE '' END` : this.text(`${e(0)}.k`, t));
    const path = tree(L.reverse().map(item), (a, b) => this.concat(a, b));
    return `SELECT ${e(0)}.k AS ${q('key')}, ${path} AS ${q('path')} FROM ${from} WHERE ${root}`;
  }

  // Rows from start to end (inclusive) by step, as a FROM item with one column `name`.
  series() { throw new Error(`${this.name}: series is not implemented`); }

  // The default of a type, which a blank compares as.
  blankOf(t) {
    if (t === 'string') return "''";
    if (t === 'bool') return 'FALSE';
    if (t === 'datetime' || t === 'date') return "DATE '1899-12-30'";
    return '0';
  }

  materialized = '';   // what follows AS in a CTE written once (DuckDB: MATERIALIZED)

  // Conditions and boolean values. Where a condition is a value as it is (a BOOLEAN), these are
  // nothing; an engine with no boolean type (T-SQL) converts between the two, and the SQL writer
  // asks for each where it needs it.
  boolValues = true;
  // Whether a subquery in a CASE's branch is decorrelated as one elsewhere is; without, the
  // SQL writer makes the branches' values a row the CASE reads.
  subqueryInCase = true;
  // SUMMARIZECOLUMNS by one calculation group's column: 'split' (a level for each item) or
  // 'smaller' (that or one level of CASEs, whichever SQL is smaller; index.js).
  splitOneGroup = 'smaller';
  // The statement as the engine is to run it, from the SQL plan-sql.js wrote.
  finish(sql) { return sql; }
  cond(v) { return v; }      // a boolean value as a condition
  value(c) { return c; }     // a condition as a boolean value, blank where it is unknown
  orFalse(c) { return `COALESCE(${c}, FALSE)`; }   // a condition that is FALSE where it is unknown
  get always() { return 'TRUE'; }                  // conditions that always, never hold
  get never() { return 'FALSE'; }
  // A WITH inside a subquery (compileStatement nests a model's query's CTEs where it is).
  get nestedWith() { return true; }

  // a and b, text, joined (neither blank).
  concat(a, b) { return `(${a} || ${b})`; }
  // An ORDER BY term: `dir` ASC or DESC, a blank FIRST or LAST.
  order(v, dir, nulls) { return `${v} ${dir} NULLS ${nulls}`; }
  // A window's ORDER BY from its terms, which can be none.
  windowOrder(terms) { return terms.length ? `ORDER BY ${terms.join(', ')}` : ''; }
  // The rows of `sql`, a subquery that reads each row of the FROM before it, as `alias`: with
  // `outer`, a row with none of them is kept, blank in their columns.
  lateral(sql, alias, outer) { return outer ? ` LEFT JOIN LATERAL (${sql}) AS ${alias} ON TRUE` : `, LATERAL (${sql}) AS ${alias}`; }

  fn(name) { throw new Error(`${this.name}: function ${name} is not implemented`); }
  agg(name) { throw new Error(`${this.name}: aggregate ${name} is not implemented`); }
}
