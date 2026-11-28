// Polars SQL (pl.SQLContext, Polars 2.2): PostgreSQL's SQL, as Polars reads it, over the
// query plan unnested (planSql { unnest: true }): Polars unnests correlated scalar, IN and
// EXISTS subqueries and LATERAL over a table, but reads no outer row in a derived table of a
// correlated subquery or a LATERAL (pola-rs/polars#31059, #31067), which the correlated plan
// writes (polars.yml measures both plans).
// As postgres.js writes it, for Polars: WITH has no MATERIALIZED (a CTE is a lazy frame, computed
// once where it is read); each relation a SELECT reads a CTE of its own (the suite in 111.6 s so,
// 125.9 s nested); a blank-safe key is IS NOT DISTINCT FROM (as fast as = since
// pola-rs/polars#31049); a value is written where it is read (a subquery's row reads the outer row
// by its columns' names alone, which Polars does not find: pola-rs/polars#31067); a series whose
// bounds are a row's reads them by scalar subqueries. What it writes differently:
// - An interval is of a fixed length only (n * INTERVAL '1 day', no months): a date moved by
//   months is made of its parts (the month's first day, the day, the month's last at most).
// - ROUND's places a constant; log10 is log10; a sum in no order (SUM takes no ORDER BY).
// - A date is a TIMESTAMP at midnight, as a DAX date is a date and time (worker.py reads each
//   date column so): a Polars DATE takes no time of day (a fraction of a day added, FORMAT's
//   hours: "`nanosecond` operation not supported for dtype `date`").
// What each is for, on the Polars it runs on: conformance/engines/dax-sql-polars/repros.py.
import { PostgresDialect } from './postgres.js';
import { generalNumber } from './postgres-format.js';
import { unsupported } from '../errors.js';

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

const DATES = new Set(['start_of', 'end_of', 'today', 'utctoday']);

// A whole number the plan gives as a constant (a literal, or one negated): its value, else null.
const constInt = n => (n?.k === 'lit' && Number.isInteger(n.v) ? n.v
  : n?.k === 'pop' && n.op === 'neg' && n.a[0]?.k === 'lit' && Number.isInteger(n.a[0].v) ? -n.a[0].v : null);
// A constant number of months: an INTERVAL (of months it is, of the month's last day at most).
const months = (x, k) => (k === 0 ? x : `(${x} ${k > 0 ? '+' : '-'} INTERVAL '${Math.abs(k)} months')`);


export class PolarsDialect extends PostgresDialect {
  name = 'polars';
  // Polars has no function of a character's code: UNICODE as the plan defines it.
  nativeFns = new Set();
  // A failing cast of a value not known beforehand (postgres.js's err) fails only where a row
  // takes its CASE branch (Polars 2.2): DAX's ERROR raises as it does in Power BI. A constant's
  // still fails in a branch no row takes (pola-rs/polars#31178), which err does not write.
  raisesWhereTaken = true;

  // A date: a TIMESTAMP (a cast to one at midnight), a constant one too.
  type(t) { return t === 'date' ? 'TIMESTAMP' : super.type(t); }
  cast(sql, t) { return t === 'date' ? `CAST(CAST(${sql} AS DATE) AS TIMESTAMP)` : super.cast(sql, t); }
  datetime(v) { return /\d:\d/.test(v) ? `TIMESTAMP ${this.str(v)}` : `TIMESTAMP ${this.str(`${v} 00:00:00`)}`; }
  blankOf(t) { return t === 'datetime' || t === 'date' ? "TIMESTAMP '1899-12-30 00:00:00'" : super.blankOf(t); }
  // generate_series as a table (its scalar form is a list); dates by a step of n days
  // (pola-rs/polars#31054).
  series(start, end, step, t) {
    if (t === 'datetime') return `(SELECT v FROM generate_series(CAST(CAST(${start} AS DATE) AS TIMESTAMP), CAST(CAST(${end} AS DATE) AS TIMESTAMP), ${int(step)} * INTERVAL '1 day') AS r(v))`;
    if (t === 'int') return `(SELECT * FROM generate_series(CAST(${start} AS BIGINT), CAST(${end} AS BIGINT), CAST(${step} AS BIGINT)) AS r(v))`;
    return super.series(start, end, step, t);
  }

  // A number as text, written in place (Polars reads no outer row in the derived table that binds
  // it: tpcds fuzz3-0136, CONCATENATEX of prices).
  text(sql, t) { return t === 'double' || t === 'decimal' ? generalNumber(sql, t, true) : super.text(sql, t); }

  // A quotient is a double, as DAX's is: Polars keeps a decimal's scale in a division by one (a
  // DECIMAL(38,10), by design: pola-rs/polars#29520), so that at scale the digits past it are
  // lost (tpcds fuzz3-0126 at SF1: 111.77739, DuckDB 111.777384). (An average of a decimal is a
  // double on Polars 2.2.)
  div(a, b) { return super.div(a, `CAST(${b} AS DOUBLE PRECISION)`); }

  fn(name, a, nodes = []) {
    if (name === 'divide') return super.fn(name, [a[0], `CAST(${a[1]} AS DOUBLE PRECISION)`, ...a.slice(2)], nodes);
    // What Polars SQL has no function for: a factorial, the time in a zone (timezone()).
    if (name === 'fact' || name === 'utcnow' || name === 'utctoday') throw unsupported(`${name.toUpperCase()} on Polars (no function of it in its SQL)`);
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
