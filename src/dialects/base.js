// What the emitter asks of a SQL dialect. The base class writes ANSI SQL where there is one;
// a dialect overrides what its engine spells differently (see duckdb.js). To add an engine,
// extend this class and implement what throws here.
//
// fn(name, args) receives the names below (the `fn` nodes of ir.js), with args as SQL text:
//   logic     isblank coalesce greatest least divide iseven isodd error row
//   math      abs sign sqrt exp ln log log10 power mod quotient round roundup rounddown int trunc
//             ceiling floor mround rand randbetween gcd lcm fact even odd value cast currency
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
export class Dialect {
  name = 'ansi';

  ident(name) { return `"${String(name).replace(/"/g, '""')}"`; }
  str(v) { return `'${String(v).replace(/'/g, "''")}'`; }
  num(v) {
    if (!Number.isFinite(v)) throw new Error(`not a finite number: ${v}`);
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
  bigint(v) { return `CAST(${this.num(v)} AS BIGINT)`; }

  // a / b as a number with a fraction.
  div(a, b) { return `(CAST(${a} AS DOUBLE PRECISION) / ${b})`; }

  isNotDistinct(a, b) { return `${a} IS NOT DISTINCT FROM ${b}`; }

  // A query's LIMIT and OFFSET, after its ORDER BY.
  limit(n, offset) { return `${n != null ? ` LIMIT ${n}` : ''}${offset ? ` OFFSET ${offset}` : ''}`; }

  isDistinct(a, b) { return `${a} IS DISTINCT FROM ${b}`; }

  // body(...vals): SQL that names each of `vals` more than once. An engine that has no way to
  // name a value once (T-SQL) writes the ones that are more than a column or a constant once,
  // in a row the body reads; nested, they would grow the SQL at each level.
  bind(vals, body) { return body(...vals); }

  // a + b where either can be blank: blank only when both are.
  blankAdd(a, b, sub) {
    return this.bind([a, b], (a, b) => `CASE WHEN ${a} IS NULL AND ${b} IS NULL THEN NULL ELSE COALESCE(${a}, 0) ${sub ? '-' : '+'} COALESCE(${b}, 0) END`);
  }

  // A value as text, the way & joins it.
  text(sql, t) {
    if (t === 'string') return sql;
    if (t === 'bool') return `CASE ${sql} WHEN TRUE THEN 'TRUE' WHEN FALSE THEN 'FALSE' END`;
    return `CAST(${sql} AS VARCHAR)`;
  }

  // PATH over a parent-child table: from `edges` (a SELECT of columns k, the key, of type t,
  // and p, its parent), a row (key, path) per key reached from a row with a blank parent, its
  // path the keys from there down joined by "|". A walk stops at as many steps as there are
  // rows, so that a cycle (duplicate keys) ends. `name` prefixes the names it declares.
  paths(edges, t, name) {
    const e = `${name}_e`, r = `${name}_r`, q = n => this.ident(n);
    return `WITH RECURSIVE ${e} AS (SELECT k, p FROM (${edges}) AS ${name}_x WHERE k IS NOT NULL), `
      + `${r}(${q('key')}, ${q('path')}, depth) AS (SELECT k, ${this.text('k', t)}, 1 FROM ${e} WHERE p IS NULL `
      + `UNION ALL SELECT c.k, r.${q('path')} || '|' || ${this.text('c.k', t)}, r.depth + 1 FROM ${e} AS c JOIN ${r} AS r ON c.p = r.${q('key')} `
      + `WHERE r.depth < (SELECT COUNT(*) FROM ${e})) `
      + `SELECT ${q('key')}, ${q('path')} FROM ${r}`;
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
  supportsQualify = false;   // without it, a SELECT around the window keeps the rows (emit.js Block)

  // Conditions and boolean values. Where a condition is a value as it is (a BOOLEAN), these are
  // nothing; an engine with no boolean type (T-SQL) converts between the two, and the emitter
  // asks for each where it needs it.
  boolValues = true;
  // Whether an aggregate can take a subquery (SUM((SELECT ...))) and GROUP BY can group by one;
  // without, the emitter makes them columns of a SELECT the aggregate is over.
  aggOverSubquery = true;
  // Whether a subquery in a CASE's branch is decorrelated as one elsewhere is; without, the
  // emitter makes the branches' values a row the CASE reads.
  subqueryInCase = true;
  // Whether a correlated semi-join over many columns runs as fast as conditions do; without, a
  // filter of a table's own rows is written as their conditions where it can be (T-SQL: minutes
  // as a loop; DuckDB: a join of the table to itself, 40 s over a million rows and 1 s so).
  correlatedSemiJoin = true;
  // Whether the aggregates an iterator's rows take over their own values are fused into a GROUP BY
  // joined to the rows (emit.js rowFused), for an engine that runs the subqueries as loops.
  fuseRows = false;
  // Whether the engine computes again what the SQL writes again (T-SQL): a CTE at each name, a
  // subquery at each copy. The emitter then writes a value once where it can.
  repeats = false;
  // Whether a fused group's rows are aggregated before its joins to the one side (emit.js
  // Fusion.belowJoins), for an engine that joins every row first.
  aggBelowJoins = false;
  // The statement as the engine is to run it, from the SQL the emitter wrote.
  finish(sql) { return sql; }
  cond(v) { return v; }      // a boolean value as a condition
  value(c) { return c; }     // a condition as a boolean value, blank where it is unknown
  orFalse(c) { return `COALESCE(${c}, FALSE)`; }   // a condition that is FALSE where it is unknown
  get always() { return 'TRUE'; }                  // conditions that always, never hold
  get never() { return 'FALSE'; }

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
  // Whether agg() takes extra.filter: the aggregate over the rows a condition keeps.
  get aggFilter() { return false; }
  // Whether agg() takes 'sum_currency': SUM of currency(x), written from x.
  get sumCurrency() { return false; }
}
