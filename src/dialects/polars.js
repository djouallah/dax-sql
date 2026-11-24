// Polars SQL (pl.SQLContext, tested on 2.1): PostgreSQL's SQL, as Polars reads it, over the
// query plan unnested (planSql { unnest: true }): Polars runs no correlated subquery and no
// LATERAL, so the plan with neither is the one it takes. What it writes differently from
// PostgreSQL's:
// - WITH has no MATERIALIZED (a CTE is a lazy frame, computed once where it is read).
// - A blank-safe key is IS NOT DISTINCT FROM (no ARRAY = ARRAY, no ROW()::record).
// - A value is written where it is read, not bound in a subquery's row (which would read the
//   outer row: a correlated subquery).
// - An interval is of a fixed length only (n * INTERVAL '1 day', no months): a date moved by
//   months is made of its parts (the month's first day, the day, the month's last at most).
// - ROUND's places a constant; log10 is log10; a sum in no order (SUM takes no ORDER BY).
import { PostgresDialect } from './postgres.js';

// A whole number (64 bits: Polars computes a CASE's branches no row takes too).
const int = v => `CAST(round(CAST(${v} AS NUMERIC)) AS BIGINT)`;
const UNITS = { day: 'DAY', week: 'WEEK', month: 'MONTH', quarter: 'QUARTER', year: 'YEAR', hour: 'HOUR', minute: 'MINUTE', second: 'SECOND' };
const unit = u => UNITS[String(u).replace(/'/g, '').toLowerCase()] ?? String(u).replace(/'/g, '').toUpperCase();
const part = (f, x) => `CAST(EXTRACT(${f} FROM ${x}) AS BIGINT)`;
// The first day of month number m (year * 12 + month - 1).
const first = m => `CAST(CONCAT(LPAD(CAST(CAST(floor((${m}) / 12) AS BIGINT) AS VARCHAR), 4, '0'), '-', LPAD(CAST(CAST((${m}) % 12 + 1 AS BIGINT) AS VARCHAR), 2, '0'), '-01') AS DATE)`;
const monthOf = x => `(${part('YEAR', x)} * 12 + ${part('MONTH', x)} - 1)`;
// A date k months on: its day in that month, or the month's last.
const addMonths = (x, k) => {
  const m = `(${monthOf(x)} + ${k})`;
  return `LEAST(${first(m)} + (${part('DAY', x)} - 1) * INTERVAL '1 day', ${first(`${m} + 1`)} - INTERVAL '1 day')`;
};

export class PolarsDialect extends PostgresDialect {
  name = 'polars';
  session = [];
  materialized = '';
  subqueryInCase = true;

  isNotDistinct(a, b) { return `(${a} IS NOT DISTINCT FROM ${b})`; }
  keysTogether = null;
  bind(vals, body) { return body(...vals); }
  sumOfGroups(v) { return `SUM(${v})`; }

  fn(name, a, nodes = []) {
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
      case 'date': return `(${first(`${int(x)} * 12 + ${int(y)} - 1`)} + (${int(z)} - 1) * INTERVAL '1 day')`;
      case 'eomonth': return `(${first(`${monthOf(x)} + ${int(y)} + 1`)} - INTERVAL '1 day')`;
      case 'add_interval': {
        const u = unit(z);
        const timeOf = v => (nodes[0]?.t === 'date' ? '' : ` + (CAST(${v} AS TIMESTAMP) - CAST(CAST(${v} AS DATE) AS TIMESTAMP))`);
        if (u === 'DAY') return `(${x} + ${int(y)} * INTERVAL '1 day')`;
        if (u === 'WEEK') return `(${x} + 7 * ${int(y)} * INTERVAL '1 day')`;
        if (u === 'MONTH' || u === 'QUARTER' || u === 'YEAR') return `(${addMonths(x, `${u === 'YEAR' ? 12 : u === 'QUARTER' ? 3 : 1} * ${int(y)}`)}${timeOf(x)})`;
        if (u === 'SECOND') return `(${x} + CAST(round(CAST(${y} AS NUMERIC) * 1000000) AS BIGINT) * INTERVAL '1 microsecond')`;
        return `(${x} + ${int(y)} * INTERVAL '1 ${u.toLowerCase()}')`;
      }
    }
    return super.fn(name, a, nodes);
  }
}
