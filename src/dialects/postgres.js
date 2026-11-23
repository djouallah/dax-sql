// PostgreSQL (tested on 17): booleans, IS NOT DISTINCT FROM, LATERAL, FILTER on an aggregate,
// WITH RECURSIVE and MATERIALIZED, as DuckDB; no QUALIFY (a SELECT around the window), no list
// (an array, or a value bound in a subquery's row), / of two whole numbers a whole number, a
// division by zero an error, and its own names for the date functions. It runs a correlated
// subquery as a loop, as Fabric does: the emitter fuses and writes once what it can (the flags).
import { Dialect } from './base.js';
import { semantic } from '../errors.js';
import { formatNumber, formatDate, generalNumber, generalDate, dateSerial, serialDate, bindAs, sqlAggregates, e14 } from './postgres-format.js';

const UNIT_SQL = { day: 'DAY', week: 'WEEK', month: 'MONTH', quarter: 'QUARTER', year: 'YEAR', hour: 'HOUR', minute: 'MINUTE', second: 'SECOND' };
const fl = x => `CAST(${x} AS DOUBLE PRECISION)`;
// A whole number of `v`, rounded half away from zero (a DOUBLE's CAST rounds half to even).
const int = v => `CAST(round(CAST(${v} AS NUMERIC)) AS INTEGER)`;
// A value to 15 significant digits.
const g15 = v => `CAST(CAST(${e14(v)} AS NUMERIC) AS DOUBLE PRECISION)`;
const part = (f, x) => `CAST(EXTRACT(${f} FROM ${x}) AS INTEGER)`;
const ERR_FIXED = 'DAX: the result of a conversion or arithmetic operation is too large or too small for a fixed decimal number';
// SQL that is a column of a row or a constant, which bind() names as it is.
const plain = v => /^\w+\.(?:"(?:[^"]|"")*"|\w+)$/.test(v) || /^-?\d+(?:\.\d+)?(?:e[-+]?\d+)?$/i.test(v) || /^'(?:[^']|'')*'$/.test(v) || v === 'NULL';

export class PostgresDialect extends Dialect {
  name = 'postgres';
  materialized = 'MATERIALIZED ';
  aggBelowJoins = true;
  repeats = true;
  fuseRows = true;
  correlatedJoin = true;
  correlatedSemiJoin = false;
  // An aggregate belongs to the query whose columns it reads: SUM((SELECT ... k1 ...)) is the
  // outer query's. Its subqueries are columns of a SELECT it is over, as on T-SQL.
  aggOverSubquery = false;
  get aggFilter() { return true; }
  get sumCurrency() { return true; }

  type(t) { return t === 'string' ? 'TEXT' : t === 'date' ? 'DATE' : super.type(t); }
  // A NULL in a subquery's column is TEXT, which no UNION arm of a number matches: typed.
  literal(v, t) { return v === null ? this.nullOf(t) : super.literal(v, t); }
  nullOf(t) { return this.type(t) ? `CAST(NULL AS ${this.type(t)})` : 'NULL'; }

  // A value more than a column or a constant, written once in a row the body reads:
  // (SELECT body FROM (SELECT x AS "v0") AS b1). One that aggregates or windows the rows around
  // it is written in place (a subquery's COUNT(*) would count its own row).
  bind(vals, body) {
    const at = vals.map((v, i) => (v == null || plain(v) ? -1 : i)).filter(i => i >= 0);
    if (!at.length || !this.alias || vals.some(v => v != null && sqlAggregates(v))) return body(...vals);
    const b = this.alias('b');
    const refs = vals.map((v, i) => (at.includes(i) ? `${b}.${this.ident(`v${i}`)}` : v));
    return `(SELECT ${body(...refs)} FROM (SELECT ${at.map(i => `${vals[i]} AS ${this.ident(`v${i}`)}`).join(', ')}) AS ${b})`;
  }

  // An error that has the type of the branch it is in: a cast that fails, its text the message.
  // A constant is computed when the query is planned, in a branch never taken too: the message
  // is read under random(), which is not.
  err(msg, t = 'double') { return `CAST(CAST(CASE WHEN random() < 2 THEN ${msg} END AS INTEGER) AS ${this.type(t)})`; }

  // A division by zero is infinity (or NaN), as on DuckDB, not an error.
  div(a, b) {
    return this.bind([a, b], (a, b) => `CASE WHEN ${b} = 0 THEN CASE WHEN ${a} > 0 THEN CAST('Infinity' AS DOUBLE PRECISION)
      WHEN ${a} < 0 THEN CAST('-Infinity' AS DOUBLE PRECISION) WHEN ${a} = 0 THEN CAST('NaN' AS DOUBLE PRECISION) END ELSE ${fl(a)} / ${b} END`);
  }

  // As DAX converts: 3.0 as "3", 0.1 + 0.2 as "0.3" (15 digits), 1E+20; a date as 1/5/2024, with
  // the time when it is not midnight; TRUE as "TRUE".
  text(sql, t) {
    if (t === 'double' || t === 'decimal') return generalNumber(sql, t);
    if (t === 'datetime' || t === 'date') return this.bind([sql], v => generalDate(v));
    if (t === 'string') return sql;
    if (t === 'bool') return super.text(sql, t);
    return `CAST(${sql} AS TEXT)`;
  }

  series(start, end, step, t) {
    if (t === 'datetime') return `(SELECT CAST(generate_series(CAST(${start} AS TIMESTAMP), CAST(${end} AS TIMESTAMP), make_interval(days => ${int(step)})) AS DATE) AS v)`;
    if (t === 'int') return `(SELECT generate_series(CAST(${start} AS BIGINT), CAST(${end} AS BIGINT), CAST(${step} AS BIGINT)) AS v)`;
    // A step with a fraction: start + step * i.
    return `(SELECT ${start} + ${step} * i AS v FROM generate_series(0, CAST(floor(${fl(`(${end}) - (${start})`)} / (${step}) + 1e-9) AS BIGINT)) AS r(i))`;
  }

  fn(name, a, nodes = []) {
    // A text function given a number reads it as text, as DAX converts it.
    const TEXT = { left: [0], right: [0], mid: [0], len: [0], upper: [0], lower: [0], trim: [0], trim_ends: [0], substitute: [0, 1, 2], replace: [0, 3],
      search: [0, 1], find: [0, 1], rept: [0], exact: [0, 1], unicode: [0], containsstring: [0, 1], containsstringexact: [0, 1],
      pathlength: [0], pathitem: [0], pathitemreverse: [0], pathcontains: [0, 1] };
    if (TEXT[name]) a = a.map((v, i) => (TEXT[name].includes(i) && nodes[i] && nodes[i].t !== 'string' && nodes[i].t !== 'blank' ? this.text(v, nodes[i].t) : v));
    const [x, y, z, w] = a;
    switch (name) {
      case 'isblank': return `(${x} IS NULL)`;
      case 'coalesce': return `COALESCE(${a.join(', ')})`;
      case 'greatest': return `greatest(${a.join(', ')})`;
      case 'least': return `least(${a.join(', ')})`;
      case 'divide': return a.length === 2 ? `(${fl(x)} / NULLIF(${y}, 0))`
        : this.bind([x, y, z], (x, y, z) => `CASE WHEN COALESCE(${y}, 0) = 0 THEN ${z} ELSE ${fl(x)} / ${y} END`);
      // A fixed decimal over a whole number: the exact quotient of ten-thousandths, rounded half
      // away from zero. Over 0 (or, for /, a blank): infinity for /, DIVIDE's alternate.
      case 'cydiv': case 'cydivide': return this.bind([x, y, z], (x, y, z) => {
        const n = `CAST(round(CAST(${x} AS NUMERIC) * 10000) AS NUMERIC(38,0))`, d = `CAST(${y} AS NUMERIC(38,0))`;
        const zero = name === 'cydiv' ? `CASE WHEN ${n} > 0 THEN CAST('Infinity' AS DOUBLE PRECISION) WHEN ${n} < 0 THEN CAST('-Infinity' AS DOUBLE PRECISION) END` : z ?? 'NULL';
        return `CASE WHEN COALESCE(${y}, 0) = 0 THEN ${zero}
          ELSE CAST(sign(${n}) * sign(${d}) * floor((2 * abs(${n}) + abs(${d})) / (2 * abs(${d}))) / 10000 AS DECIMAL(19,4)) END`;
      });
      case 'iseven': return `(CAST(trunc(${x}) AS BIGINT) % 2 = 0)`;
      case 'isodd': return `(CAST(trunc(${x}) AS BIGINT) % 2 <> 0)`;
      case 'error': return this.err(x);
      case 'row': return `ROW(${a.join(', ')})`;
      // math
      case 'abs': case 'sign': case 'sqrt': case 'exp': case 'ln': return `${name}(${x})`;
      case 'log10': return `log(${x})`;
      case 'gcd': case 'lcm': return `${name}(${a.map(v => `CAST(${v} AS BIGINT)`).join(', ')})`;
      case 'log': return `(ln(${x}) / ln(${y}))`;
      case 'power': return `power(${fl(x)}, ${y})`;
      case 'mod': return this.bind([x, y], (x, y) => `(${x} - ${y} * floor(${fl(x)} / ${y}))`);
      case 'quotient': return `CAST(trunc(${fl(x)} / ${y}) AS BIGINT)`;
      case 'round': return `CAST(round(CAST(${x} AS NUMERIC), ${int(y)}) AS DOUBLE PRECISION)`;
      // A fixed decimal: four places, within a 64-bit count of ten-thousandths.
      case 'currency': return this.bind([x], x => `CASE WHEN abs(${x}) >= 922337203685477.5808 THEN ${this.err(this.str(ERR_FIXED), 'decimal')}
        ELSE CAST(round(CAST(${x} AS NUMERIC), 4) AS DECIMAL(19,4)) END`);
      // The value scaled to the digit that is kept is read to 15 significant digits before it is
      // cut, as Power BI does (duckdb.js).
      case 'roundup': return this.bind([x, y], (x, y) => `(sign(${x}) * ceil(${g15(`abs(${x}) * power(10, ${y})`)}) / power(10, ${y}))`);
      case 'rounddown': case 'trunc': return this.bind([x, y], (x, y) => `(trunc(${g15(`${x} * power(10, ${y})`)}) / power(10, ${y}))`);
      case 'int': return `CAST(floor(${x}) AS BIGINT)`;
      case 'ceiling': return y ? this.bind([y], y => `(ceil(${g15(`${fl(x)} / ${y}`)}) * ${y})`) : `ceil(${x})`;
      case 'floor': return y ? this.bind([y], y => `(floor(${g15(`${fl(x)} / ${y}`)}) * ${y})`) : `floor(${x})`;
      case 'mround': return this.bind([y], y => `(round(CAST(${g15(`${fl(x)} / ${y}`)} AS NUMERIC)) * ${y})`);
      case 'rand': return 'random()';
      case 'randbetween': return `CAST(floor(random() * (${y} - ${x} + 1)) + ${x} AS BIGINT)`;
      case 'fact': return `factorial(CAST(${x} AS BIGINT))`;
      case 'even': return `CAST(sign(${x}) * ceil(abs(${fl(x)}) / 2) * 2 AS BIGINT)`;
      case 'odd': return `CAST(sign(${x}) * (ceil((abs(${fl(x)}) + 1) / 2) * 2 - 1) AS BIGINT)`;
      case 'value': return fl(x);
      // Text as a date: PostgreSQL reads ISO, and en-US's 3/5/2024 and March 5, 2024 (DateStyle MDY).
      case 'cast': return this.cast(x, JSON.parse(y.replace(/^'|'$/g, '"')));
      // text
      case 'left': return `left(${x}, ${y ? int(y) : 1})`;
      case 'right': return `right(${x}, ${y ? int(y) : 1})`;
      case 'mid': return `substr(${x}, ${int(y)}, ${int(z)})`;
      case 'len': return `length(${x})`;
      case 'upper': return `upper(${x})`;
      case 'lower': return `lower(${x})`;
      case 'trim': return `regexp_replace(trim(${x}), ' {2,}', ' ', 'g')`;
      case 'trim_ends': return `trim(${x})`;
      case 'substitute': {
        if (w === undefined) return `replace(${x}, ${y}, ${z})`;
        // The w-th occurrence only: the text split on the old text, its first w pieces and the
        // rest joined back around the new text. Unchanged with fewer occurrences.
        return this.bind([x, y, int(w)], (x, y, n) => {
          const parts = `string_to_array(${x}, ${y})`;
          return `CASE WHEN ${n} < 1 THEN ${this.err(this.str('DAX: SUBSTITUTE: the instance number must be 1 or more'), 'string')}
            WHEN ${y} = '' OR ${n} >= cardinality(${parts}) THEN ${x}
            ELSE array_to_string((${parts})[1:${n}], ${y}) || ${z} || array_to_string((${parts})[${n} + 1:], ${y}) END`;
        });
      }
      case 'replace': return `(left(${x}, ${int(y)} - 1) || ${w} || substr(${x}, ${int(`${y} + ${z}`)}))`;
      case 'search': case 'find': {
        const low = s => (name === 'search' ? `lower(${s})` : s);
        return this.bind([x, y, int(z)], (x, y, z) => {
          const pos = `strpos(${low(`substr(COALESCE(${y}, ''), ${z})`)}, ${low(`COALESCE(${x}, '')`)})`;
          return `CASE WHEN ${pos} = 0 THEN ${w} ELSE ${pos} + ${z} - 1 END`;
        });
      }
      case 'rept': return `repeat(${x}, ${int(y)})`;
      case 'exact': return `(COALESCE(${x}, '') = COALESCE(${y}, ''))`;
      case 'unichar': return `chr(${int(x)})`;
      case 'unicode': return `ascii(${x})`;
      case 'containsstring': return `(strpos(lower(COALESCE(${x}, '')), lower(COALESCE(${y}, ''))) > 0)`;
      case 'containsstringexact': return `(strpos(COALESCE(${x}, ''), COALESCE(${y}, '')) > 0)`;
      // A path's items: "" is a path of none, and a blank path's length is blank; a position past
      // either end is blank.
      case 'pathlength': return `CASE WHEN ${x} = '' THEN 0 ELSE cardinality(string_to_array(${x}, '|')) END`;
      case 'pathitem': return `CASE WHEN ${y} >= 1 THEN (string_to_array(NULLIF(${x}, ''), '|'))[CAST(${y} AS INTEGER)] END`;
      case 'pathitemreverse': return this.bind([x], x => `CASE WHEN ${y} >= 1 THEN (string_to_array(NULLIF(${x}, ''), '|'))[cardinality(string_to_array(NULLIF(${x}, ''), '|')) + 1 - CAST(${y} AS INTEGER)] END`);
      case 'pathcontains': return `COALESCE(${y} = ANY(string_to_array(NULLIF(${x}, ''), '|')), FALSE)`;
      case 'combinevalues': return `concat_ws(${x}, ${a.slice(1).map((v, i) => `COALESCE(${nodes[i + 1] ? this.text(v, nodes[i + 1].t) : `CAST(${v} AS TEXT)`}, '')`).join(', ')})`;
      case 'format_date': return formatDate(x, JSON.parse(nodes[1].v));
      case 'format_number': return formatNumber(x, JSON.parse(nodes[1].v), nodes[0].t);
      case 'date_serial': return dateSerial(x);
      case 'serial_date': return serialDate(x);
      // dates
      case 'date': return `CAST(make_date(${int(x)}, 1, 1) + make_interval(months => ${int(y)} - 1, days => ${int(z)} - 1) AS DATE)`;
      // A time is a date and time on day zero (1899-12-30), as in DAX.
      // Hours past 23, minutes and seconds past 59 carry, and the day they make is dropped.
      case 'time': return `(TIMESTAMP '1899-12-30' + CAST(round(mod(CAST(${x} AS NUMERIC) * 3600 + CAST(${y} AS NUMERIC) * 60 + CAST(${z} AS NUMERIC), 86400) * 1000000) AS BIGINT) * INTERVAL '1 microsecond')`;
      // A date and time plus another: the second's time since day zero added to the first.
      case 'add_datetimes': {
        const z0 = "TIMESTAMP '1899-12-30'", T = v => `COALESCE(CAST(${v} AS TIMESTAMP), ${z0})`;
        return `CASE WHEN ${x} IS NULL AND ${y} IS NULL THEN NULL ELSE ${T(x)} + (${T(y)} - ${z0}) END`;
      }
      case 'year': case 'month': case 'day': case 'hour': case 'minute': case 'quarter': return part(name.toUpperCase(), x);
      case 'second': return `CAST(floor(EXTRACT(SECOND FROM ${x})) AS INTEGER)`;
      case 'weekday': return this.bind([x], x => `CASE ${int(y)} WHEN 2 THEN ${part('ISODOW', x)} WHEN 3 THEN ${part('ISODOW', x)} - 1 ELSE ${part('DOW', x)} + 1 END`);
      case 'weeknum': return this.bind([x], x => {
        const jan1 = `make_date(${part('YEAR', x)}, 1, 1)`;
        return `CASE WHEN ${int(y)} = 21 THEN ${part('WEEK', x)}
        WHEN ${int(y)} = 2 THEN CAST(floor((${part('DOY', x)} - 1 + ${part('ISODOW', jan1)} - 1) / 7.0) + 1 AS BIGINT)
        ELSE CAST(floor((${part('DOY', x)} - 1 + ${part('DOW', jan1)}) / 7.0) + 1 AS BIGINT) END`;
      });
      case 'eomonth': return `CAST(date_trunc('month', ${x} + make_interval(months => ${int(y)})) + INTERVAL '1 month' - INTERVAL '1 day' AS DATE)`;
      case 'add_interval': {
        const u = unit(z);
        // A date moved by days or months stays a DATE (DATE + INTERVAL is a TIMESTAMP).
        const asDate = v => (nodes[0]?.t === 'date' ? `CAST(${v} AS DATE)` : v);
        if (u === 'DAY') return asDate(`(${x} + make_interval(days => ${int(y)}))`);
        if (u === 'WEEK') return asDate(`(${x} + make_interval(days => 7 * ${int(y)}))`);
        if (u === 'MONTH' || u === 'QUARTER' || u === 'YEAR') return asDate(`(${x} + make_interval(months => ${u === 'YEAR' ? 12 : u === 'QUARTER' ? 3 : 1} * ${int(y)}))`);
        return `(${x} + make_interval(${u === 'HOUR' ? 'hours' : u === 'MINUTE' ? 'mins' : 'secs'} => ${u === 'SECOND' ? fl(y) : int(y)}))`;
      }
      // The boundaries crossed from x to y, as DuckDB's date_diff counts them; weeks start on
      // Sunday (as SQL Server's DATEDIFF counts them).
      case 'datediff': return this.bind([x, y], (x, y) => {
        const u = unit(z), D = v => `CAST(${v} AS DATE)`, Y = v => part('YEAR', v);
        const epoch = (f, n) => `CAST((EXTRACT(EPOCH FROM date_trunc('${f}', ${y})) - EXTRACT(EPOCH FROM date_trunc('${f}', ${x}))) / ${n} AS BIGINT)`;
        if (u === 'DAY') return `CAST(${D(y)} - ${D(x)} AS BIGINT)`;
        if (u === 'WEEK') return `CAST(((${D(y)} - ${part('DOW', y)}) - (${D(x)} - ${part('DOW', x)})) / 7 AS BIGINT)`;
        if (u === 'MONTH') return `CAST((${Y(y)} - ${Y(x)}) * 12 + ${part('MONTH', y)} - ${part('MONTH', x)} AS BIGINT)`;
        if (u === 'QUARTER') return `CAST((${Y(y)} - ${Y(x)}) * 4 + ${part('QUARTER', y)} - ${part('QUARTER', x)} AS BIGINT)`;
        if (u === 'YEAR') return `CAST(${Y(y)} - ${Y(x)} AS BIGINT)`;
        return epoch(u.toLowerCase(), u === 'HOUR' ? 3600 : u === 'MINUTE' ? 60 : 1);
      });
      case 'start_of': return `CAST(date_trunc('${unit(y).toLowerCase()}', ${x}) AS DATE)`;
      case 'end_of': {
        const u = unit(y);
        if (u === 'DAY') return `CAST(${x} AS DATE)`;
        return `CAST(date_trunc('${u.toLowerCase()}', ${x}) + INTERVAL '${u === 'YEAR' ? 12 : u === 'QUARTER' ? 3 : 1} months' - INTERVAL '1 day' AS DATE)`;
      }
      case 'today': return 'current_date';
      case 'now': return 'localtimestamp';
      case 'utctoday': return "CAST(timezone('UTC', now()) AS DATE)";
      case 'utcnow': return "timezone('UTC', now())";
    }
    return super.fn(name, a);
  }

  // The groups added in their values' order (a DECIMAL's sum would round them to 15 places).
  sumOfGroups(v) { return `SUM(${v} ORDER BY ${v})`; }
  agg(fn, x, extra = {}) {
    const f = extra.filter ? ` FILTER (WHERE ${extra.filter})` : '';
    const and = c => ` FILTER (WHERE ${c}${extra.filter ? ` AND ${extra.filter}` : ''})`;
    switch (fn) {
      // extra.exact: a sum of floating-point values as a DECIMAL's, the same in any order
      // (duckdb.js); 'groups': left a DECIMAL, for the groups it is added up from.
      case 'sum': return extra.exact && extra.t === 'double'
        ? (extra.exact === 'groups' ? `SUM(CAST(${x} AS DECIMAL(38,15)))${f}` : `CAST(SUM(CAST(${x} AS DECIMAL(38,15)))${f} AS DOUBLE PRECISION)`) : `SUM(${x})${f}`;
      // A sum of fixed decimals: each rounded to four places, and an error if one is out of
      // range, the range checked once, on the largest.
      case 'sum_currency': return `CASE WHEN MAX(abs(${x}))${f} >= 922337203685477.5808 THEN ${this.err(this.str(ERR_FIXED), 'decimal')} ELSE SUM(round(CAST(${x} AS NUMERIC), 4))${f} END`;
      case 'avg': return extra.exact && extra.t === 'double' ? `CAST(AVG(CAST(${x} AS DECIMAL(38,15)))${f} AS DOUBLE PRECISION)` : `AVG(${x})${f}`;
      case 'min': return `MIN(${x})${f}`;
      case 'max': return `MAX(${x})${f}`;
      case 'count': return `NULLIF(COUNT(${x})${f}, 0)`;
      case 'count0': return `COUNT(${x})${f}`;
      case 'countrows': return `NULLIF(COUNT(*)${f}, 0)`;
      // DAX counts a blank as a value.
      case 'dcount': return `(COUNT(DISTINCT ${x})${f} + MAX(CASE WHEN ${x} IS NULL THEN 1 ELSE 0 END)${f})`;
      case 'dcount0': return `COUNT(DISTINCT ${x})${f}`;
      case 'dcountnb': return `NULLIF(COUNT(DISTINCT ${x})${f}, 0)`;
      case 'countblank': return `NULLIF(COUNT(*)${and(`${x} IS NULL`)}, 0)`;
      case 'hasone': return `COALESCE(COUNT(DISTINCT ${x})${f} + MAX(CASE WHEN ${x} IS NULL THEN 1 ELSE 0 END)${f} = 1, FALSE)`;
      // No PRODUCT: the sign from the negatives counted, the size from the sum of logarithms (as
      // NUMERICs, exact to many more digits than a DOUBLE holds); 0 when one is 0.
      case 'product': return `CASE WHEN COUNT(${x})${f} = 0 THEN NULL WHEN COUNT(*)${and(`${x} = 0`)} > 0 THEN 0
        ELSE CAST((1 - 2 * mod(COUNT(*)${and(`${x} < 0`)}, 2)) * exp(SUM(ln(abs(CAST(${x} AS NUMERIC))))${f}) AS DOUBLE PRECISION) END`;
      case 'median': return `percentile_cont(0.5) WITHIN GROUP (ORDER BY ${x})${f}`;
      case 'stdev_s': return `stddev_samp(${x})${f}`;
      case 'stdev_p': return `stddev_pop(${x})${f}`;
      case 'var_s': return `var_samp(${x})${f}`;
      case 'var_p': return `var_pop(${x})${f}`;
      case 'concat': return `string_agg(COALESCE(CAST(${x} AS TEXT), ''), ${extra.delim}${extra.order?.length ? ` ORDER BY ${extra.order.join(', ')}` : ''})${f}`;
      // PERCENTILE.INC of a column (its blanks left out) with a constant k: percentile_cont, which
      // is an error outside 0..1 as DAX is.
      case 'pct_inc':
        if (/^[\d.]+$/.test(String(extra.k).trim())) return `percentile_cont(${extra.k}) WITHIN GROUP (ORDER BY ${x})${f}`;
        // falls through: k is not a constant
      // The others as DuckDB's (duckdb.js), over an array of the values in order: the value at
      // rank k(n - 1) + 1 (INC) or k(n + 1) (EXC), between the two around it. The array is an
      // aggregate of the rows around the subquery that binds it (its argument reads only them).
      case 'pct_exc': case 'pctx_inc': case 'pctx_exc': {
        const inc = fn.endsWith('_inc'), i = 'CAST(floor(dax_r) AS INTEGER)', k = `COALESCE(${extra.k}, 0)`;
        const n = 'cardinality(dax_l)';
        const r = inc ? `${k} * (${n} - 1) + 1` : `${k} * (${n} + 1)`;
        const range = inc ? 'PERCENTILE.INC: k must lie in 0..1' : 'PERCENTILE.EXC: k must lie in 1/(n + 1)..n/(n + 1)';
        const lo = `COALESCE(dax_l[${i}], 0)`;
        const body = `CASE WHEN ${n} = 0 THEN NULL
          WHEN dax_r < 1 OR dax_r > ${n} THEN ${this.err(this.str(`DAX: ${range}`))}
          WHEN dax_r = ${i} THEN dax_l[${i}]
          ELSE ${lo} + (dax_r - ${i}) * (dax_l[${i} + 1] - ${lo}) END`;
        const keep = fn.startsWith('pctx_') ? f : and(`${x} IS NOT NULL`);
        const list = `COALESCE(array_agg(${fl(x)} ORDER BY ${x} ASC NULLS FIRST)${keep}, CAST(ARRAY[] AS DOUBLE PRECISION[]))`;
        return `(SELECT ${body} FROM (SELECT dax_l, ${r} AS dax_r FROM (SELECT ${list} AS dax_l) AS dax_a) AS dax_b)`;
      }
    }
    return super.agg(fn, x);
  }
}

function unit(sqlStr) {
  const u = UNIT_SQL[String(sqlStr).replace(/'/g, '').toLowerCase()];
  if (!u) throw semantic(`unknown unit ${sqlStr}`);
  return u;
}

