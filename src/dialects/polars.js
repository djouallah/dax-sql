// Polars SQL (pl.SQLContext, tested on its main branch): PostgreSQL's SQL, as Polars reads it, over the
// query plan unnested (planSql { unnest: true }): Polars main unnests correlated scalar, IN and
// EXISTS subqueries, but has no LATERAL and reads no outer row through a derived table, which the
// correlated plan needs (polars.yml measures it beside). What it writes differently from
// PostgreSQL's:
// - WITH has no MATERIALIZED (a CTE is a lazy frame, computed once where it is read).
// - A blank-safe key is = of COALESCE with a value no data holds (no ARRAY = ARRAY, no
//   ROW()::record; IS NOT DISTINCT FROM joins tens of times slower).
// - A value is written where it is read, not bound in a subquery's row (which would read the
//   outer row: a correlated subquery).
// - An interval is of a fixed length only (n * INTERVAL '1 day', no months): a date moved by
//   months is made of its parts (the month's first day, the day, the month's last at most).
// - ROUND's places a constant; log10 is log10; a sum in no order (SUM takes no ORDER BY).
// - A date is a TIMESTAMP at midnight, as the data's dates are (worker.py reads each date column
//   as a date and time): one type, so two dates are compared, joined and unioned as they are
//   (Polars joins no DATE to a TIMESTAMP).
// What each is for, on the Polars it runs on: conformance/engines/dax-sql-polars/repros.py.
import { PostgresDialect } from './postgres.js';

// A whole number (64 bits: Polars computes a CASE's branches no row takes too).
const int = v => `CAST(round(CAST(${v} AS NUMERIC)) AS BIGINT)`;
const UNITS = { day: 'DAY', week: 'WEEK', month: 'MONTH', quarter: 'QUARTER', year: 'YEAR', hour: 'HOUR', minute: 'MINUTE', second: 'SECOND' };
const unit = u => UNITS[String(u).replace(/'/g, '').toLowerCase()] ?? String(u).replace(/'/g, '').toUpperCase();
const part = (f, x) => `CAST(EXTRACT(${f} FROM ${x}) AS BIGINT)`;
// The first day of month number m (year * 12 + month - 1).
// (|| keeps a blank blank: CONCAT reads it as '', which is no date.)
const first = m => `CAST(CAST(LPAD(CAST(CAST(floor((${m}) / 12) AS BIGINT) AS VARCHAR), 4, '0') || '-' || LPAD(CAST(CAST((${m}) % 12 + 1 AS BIGINT) AS VARCHAR), 2, '0') || '-01' AS DATE) AS TIMESTAMP)`;
const monthOf = x => `(${part('YEAR', x)} * 12 + ${part('MONTH', x)} - 1)`;
// A date k months on: its day in that month, or the month's last.
const addMonths = (x, k) => {
  const m = `(${monthOf(x)} + ${k})`;
  return `LEAST(${first(m)} + (${part('DAY', x)} - 1) * INTERVAL '1 day', ${first(`${m} + 1`)} - INTERVAL '1 day')`;
};

// A whole number the plan gives as a constant (a literal, or one negated): its value, else null.
const constInt = n => (n?.k === 'lit' && Number.isInteger(n.v) ? n.v
  : n?.k === 'pop' && n.op === 'neg' && n.a[0]?.k === 'lit' && Number.isInteger(n.a[0].v) ? -n.a[0].v : null);
// A constant number of months: an INTERVAL (of months it is, of the month's last day at most).
const months = (x, k) => (k === 0 ? x : `(${x} ${k > 0 ? '+' : '-'} INTERVAL '${Math.abs(k)} months')`);

// A blank as a key, by type: a value no data holds.
const SENTINELS = {
  int: 'CAST(-9223372036854775807 AS BIGINT)', double: 'CAST(-1.7976931348623157e308 AS DOUBLE PRECISION)',
  decimal: 'CAST(-99999999999999.9999 AS DECIMAL(19,4))', string: "'\u0001'",
  date: "TIMESTAMP '0001-01-01 00:00:00'", datetime: "TIMESTAMP '0001-01-01 00:00:00'",
};
const DATES = new Set(['start_of', 'end_of', 'today', 'utctoday']);

export class PolarsDialect extends PostgresDialect {
  name = 'polars';
  // Polars has no function of a character's code: UNICODE as the plan defines it.
  nativeFns = new Set();
  session = [];
  materialized = '';
  subqueryInCase = true;
  // Each relation a SELECT reads a CTE of its own: Polars' parser takes subqueries nested only
  // so deep (a calculation group's plan is past it).
  flatSql = true;
  // A CASE's branches no row takes are computed too: DAX's runtime errors are blanks.
  computesEveryBranch = true;

  // A blank-safe key: = of each side with a blank as a value of its type no data holds (Polars
  // joins on IS NOT DISTINCT FROM tens of times slower than on =: repros.py; past 30 s for a
  // LASTNONBLANK).
  isNotDistinct(a, b, t) {
    const none = SENTINELS[t];
    if (!none) return `(${a} IS NOT DISTINCT FROM ${b})`;
    return `(COALESCE(${a}, ${none}) = COALESCE(${b}, ${none}))`;
  }

  // A date: a TIMESTAMP (a cast to one at midnight), a constant one too.
  type(t) { return t === 'date' ? 'TIMESTAMP' : super.type(t); }
  cast(sql, t) { return t === 'date' ? `CAST(CAST(${sql} AS DATE) AS TIMESTAMP)` : super.cast(sql, t); }
  datetime(v) { return /\d:\d/.test(v) ? `TIMESTAMP ${this.str(v)}` : `TIMESTAMP ${this.str(`${v} 00:00:00`)}`; }
  blankOf(t) { return t === 'datetime' || t === 'date' ? "TIMESTAMP '1899-12-30 00:00:00'" : super.blankOf(t); }
  keysTogether = null;
  bind(vals, body) { return body(...vals); }
  sumOfGroups(v) { return `SUM(${v})`; }
  // generate_series as a table (its scalar form is a list); dates as days since 1970 (its step
  // no interval).
  series(start, end, step, t) {
    if (t === 'datetime') return `(SELECT CAST(CAST(i AS DATE) AS TIMESTAMP) AS v FROM generate_series(CAST(CAST(${start} AS DATE) AS BIGINT), CAST(CAST(${end} AS DATE) AS BIGINT), ${int(step)}) AS r(i))`;
    if (t === 'int') return `(SELECT * FROM generate_series(CAST(${start} AS BIGINT), CAST(${end} AS BIGINT), CAST(${step} AS BIGINT)) AS r(v))`;
    return super.series(start, end, step, t);
  }
  // A series whose bounds are a row's: read off that row by scalar subqueries (no LATERAL).
  seriesBoundsAsSubqueries = true;

  fn(name, a, nodes = []) {
    // PostgreSQL's functions of a date that give a DATE: a TIMESTAMP.
    if (DATES.has(name)) return `CAST(${super.fn(name, a, nodes)} AS TIMESTAMP)`;
    const [x, y, z] = a;
    switch (name) {
      case 'log10': return `log10(${x})`;
      case 'round': {
        const n = nodes[1];
        if (n?.k === 'lit' && Number.isInteger(n.v)) return `CAST(round(CAST(${x} AS NUMERIC), ${n.v}) AS DOUBLE PRECISION)`;
        return `CAST(round(CAST(${x} AS NUMERIC) * power(10, ${y})) / power(10, ${y}) AS DOUBLE PRECISION)`;
      }
      // A date less a date is a duration (its BIGINT microseconds): days as the days since 1970.
      case 'datediff': {
        const u = unit(z), days = v => `CAST(CAST(${v} AS DATE) AS BIGINT)`, dow = v => part('DOW', v);
        if (u === 'DAY') return `(${days(y)} - ${days(x)})`;
        if (u === 'WEEK') return `CAST(((${days(y)} - ${dow(y)}) - (${days(x)} - ${dow(x)})) / 7 AS BIGINT)`;
        return super.fn(name, a, nodes);
      }
      case 'eomonth': {
        const k = constInt(nodes[1]);
        if (k != null) return `(CAST(date_trunc('month', ${months(x, k)}) AS TIMESTAMP) + INTERVAL '1 months' - INTERVAL '1 day')`;
        return `(${first(`${monthOf(x)} + ${int(y)} + 1`)} - INTERVAL '1 day')`;
      }
      case 'add_interval': {
        const u = unit(z);
        const timeOf = v => (nodes[0]?.t === 'date' ? '' : ` + (CAST(${v} AS TIMESTAMP) - CAST(CAST(${v} AS DATE) AS TIMESTAMP))`);
        if (u === 'DAY') return `(${x} + ${int(y)} * INTERVAL '1 day')`;
        if (u === 'WEEK') return `(${x} + 7 * ${int(y)} * INTERVAL '1 day')`;
        const per = u === 'YEAR' ? 12 : u === 'QUARTER' ? 3 : 1, k = constInt(nodes[1]);
        if ((u === 'MONTH' || u === 'QUARTER' || u === 'YEAR') && k != null) return months(x, per * k);
        if (u === 'MONTH' || u === 'QUARTER' || u === 'YEAR') return `(${addMonths(x, `${u === 'YEAR' ? 12 : u === 'QUARTER' ? 3 : 1} * ${int(y)}`)}${timeOf(x)})`;
        if (u === 'SECOND') return `(${x} + CAST(round(CAST(${y} AS NUMERIC) * 1000000) AS BIGINT) * INTERVAL '1 microsecond')`;
        return `(${x} + ${int(y)} * INTERVAL '1 ${u.toLowerCase()}')`;
      }
    }
    return super.fn(name, a, nodes);
  }
}
