// Apache DataFusion's SQL (tested on 55): PostgreSQL's SQL, as DataFusion reads it, over the
// query plan unnested (planSql { unnest: true }: DataFusion unnests correlated subqueries of a
// few forms only). What it writes differently from PostgreSQL's:
// - No session settings, and WITH has no MATERIALIZED.
// - Each relation a SELECT reads is a CTE of its own: DataFusion's parser nests only so deep.
// - A blank-safe key is IS NOT DISTINCT FROM, which DataFusion joins on as on = (no arrays, no
//   ROW()::record).
// - A value is written where it is read, not bound in a subquery's row (a correlated subquery).
// - An interval of n units is cast from text ('n days'): no make_interval.
// - generate_series is a table (its rows' column `value`); a series whose bounds are a row's
//   reads them by scalar subqueries (no LATERAL).
// - A sum in no order (SUM takes no ORDER BY); MEDIAN is median.
import { PostgresDialect } from './postgres.js';

const UNITS = { day: 'DAY', week: 'WEEK', month: 'MONTH', quarter: 'QUARTER', year: 'YEAR', hour: 'HOUR', minute: 'MINUTE', second: 'SECOND' };
const unit = u => UNITS[String(u).replace(/'/g, '').toLowerCase()] ?? String(u).replace(/'/g, '').toUpperCase();
const part = (f, x) => `CAST(date_part('${f.toLowerCase()}', ${x}) AS BIGINT)`;
// A whole number, rounded half away from zero.
const int = v => `CAST(round(CAST(${v} AS DOUBLE)) AS BIGINT)`;
// n units as an interval.
const every = (n, u) => `CAST(CONCAT(CAST(${n} AS VARCHAR), ' ${u}') AS INTERVAL)`;
const days = v => `CAST(CAST(${v} AS DATE) AS BIGINT)`;

export class DataFusionDialect extends PostgresDialect {
  name = 'datafusion';
  session = [];
  materialized = '';
  subqueryInCase = true;
  flatSql = true;
  seriesBoundsAsSubqueries = true;
  keysTogether = null;

  isNotDistinct(a, b) { return `(${a} IS NOT DISTINCT FROM ${b})`; }
  type(t) { return t === 'string' ? 'VARCHAR' : t === 'double' ? 'DOUBLE' : super.type(t); }
  bind(vals, body) { return body(...vals); }
  sumOfGroups(v) { return `SUM(${v})`; }

  series(start, end, step, t) {
    if (t === 'datetime') return `(SELECT CAST(value AS DATE) AS v FROM generate_series(CAST(${start} AS TIMESTAMP), CAST(${end} AS TIMESTAMP), ${every(int(step), 'days')}))`;
    if (t === 'int') return `(SELECT value AS v FROM generate_series(CAST(${start} AS BIGINT), CAST(${end} AS BIGINT), CAST(${step} AS BIGINT)))`;
    // A step with a fraction: start + step * i.
    return `(SELECT ${start} + ${step} * value AS v FROM generate_series(0, CAST(floor(CAST((${end}) - (${start}) AS DOUBLE) / (${step}) + 1e-9) AS BIGINT)))`;
  }

  fn(name, a, nodes = []) {
    const [x, y, z] = a;
    switch (name) {
      case 'log10': return `log10(${x})`;
      case 'sign': return `signum(${x})`;
      case 'round': {
        const n = nodes[1];
        if (n?.k === 'lit' && Number.isInteger(n.v)) return `round(CAST(${x} AS DOUBLE), ${n.v})`;
        return `(round(CAST(${x} AS DOUBLE) * power(10, ${y})) / power(10, ${y}))`;
      }
      case 'median': return `median(${x})`;
      case 'eomonth': return `CAST(date_trunc('month', ${x} + ${every(int(y), 'months')}) + INTERVAL '1 month' - INTERVAL '1 day' AS DATE)`;
      case 'add_interval': {
        const u = unit(z);
        const asDate = v => (nodes[0]?.t === 'date' ? `CAST(${v} AS DATE)` : v);
        if (u === 'DAY') return asDate(`(${x} + ${every(int(y), 'days')})`);
        if (u === 'WEEK') return asDate(`(${x} + ${every(`7 * ${int(y)}`, 'days')})`);
        if (u === 'MONTH' || u === 'QUARTER' || u === 'YEAR') return asDate(`(${x} + ${every(`${u === 'YEAR' ? 12 : u === 'QUARTER' ? 3 : 1} * ${int(y)}`, 'months')})`);
        if (u === 'SECOND') return `(${x} + ${every(`CAST(round(CAST(${y} AS DOUBLE) * 1000000) AS BIGINT)`, 'microseconds')})`;
        return `(${x} + ${every(int(y), u.toLowerCase() + 's')})`;
      }
      // The boundaries crossed from x to y; days as the days since 1970, weeks from Sunday.
      case 'datediff': {
        const u = unit(z), Y = v => part('YEAR', v);
        if (u === 'DAY') return `(${days(y)} - ${days(x)})`;
        if (u === 'WEEK') return `CAST(((${days(y)} - ${part('DOW', y)}) - (${days(x)} - ${part('DOW', x)})) / 7 AS BIGINT)`;
        if (u === 'MONTH') return `((${Y(y)} - ${Y(x)}) * 12 + ${part('MONTH', y)} - ${part('MONTH', x)})`;
        if (u === 'QUARTER') return `((${Y(y)} - ${Y(x)}) * 4 + ${part('QUARTER', y)} - ${part('QUARTER', x)})`;
        if (u === 'YEAR') return `(${Y(y)} - ${Y(x)})`;
        const n = u === 'HOUR' ? 3600 : u === 'MINUTE' ? 60 : 1;
        return `CAST((date_part('epoch', date_trunc('${u.toLowerCase()}', ${y})) - date_part('epoch', date_trunc('${u.toLowerCase()}', ${x}))) / ${n} AS BIGINT)`;
      }
      case 'year': case 'month': case 'day': case 'hour': case 'minute': case 'quarter': return part(name, x);
    }
    return super.fn(name, a, nodes);
  }

  agg(fn, x, extra = {}) {
    if (fn === 'median') return `median(${x})${extra.filter ? ` FILTER (WHERE ${extra.filter})` : ''}`;
    return super.agg(fn, x, extra);
  }
}
