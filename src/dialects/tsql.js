// T-SQL, as the Microsoft Fabric SQL analytics endpoint and Warehouse run it (tested there): no
// boolean type, no NULLS FIRST/LAST, no FILTER on an aggregate, no LIMIT, no LATERAL (APPLY), no
// recursive CTE, and no aggregate over a subquery; but QUALIFY, ||, double-quoted names, MEDIAN,
// PERCENTILE_CONT as an aggregate and FORMAT, which SQL Server lacks in part.
import { Dialect } from './base.js';
import { unsupported } from '../errors.js';

const UNIT_SQL = { day: 'DAY', week: 'WEEK', month: 'MONTH', quarter: 'QUARTER', year: 'YEAR', hour: 'HOUR', minute: 'MINUTE', second: 'SECOND' };
// Text compared exactly whatever the database's collation (EXACT, FIND, SUBSTITUTE).
const BIN = 'Latin1_General_100_BIN2_UTF8';
const DAY0 = "CAST('1899-12-30' AS DATETIME2(6))";

// A whole number of `v`, rounded as DuckDB casts a number to INTEGER.
const int = v => `CAST(ROUND(${v}, 0) AS INT)`;
// Monday 1 .. Sunday 7, and Sunday 0 .. Saturday 6, whatever DATEFIRST is.
const isodow = x => `(DATEDIFF(DAY, CAST('1900-01-01' AS DATE), ${x}) % 7 + 1)`;
const dow = x => `(DATEDIFF(DAY, CAST('1899-12-31' AS DATE), ${x}) % 7)`;
const fl = x => `CAST(${x} AS FLOAT)`;

export class TSqlDialect extends Dialect {
  name = 'tsql';
  supportsQualify = true;
  boolValues = false;
  aggOverSubquery = false;
  subqueryInCase = false;
  correlatedSemiJoin = false;
  fuseRows = true;
  repeats = true;

  // Fabric drops a varchar literal's trailing spaces in a query over a table (', ' || x is ",x"),
  // but not a cast one's.
  str(v) {
    const s = String(v), lit = `${/[^\x00-\x7f]/.test(s) ? 'N' : ''}'${s.replace(/'/g, "''")}'`;
    return / $/.test(s) ? `CAST(${lit} AS VARCHAR(8000))` : lit;
  }
  bool(v) { return v ? 'CAST(1 AS BIT)' : 'CAST(0 AS BIT)'; }
  // A blank of its type: Fabric's IN over an untyped NULL (an INT) keeps nothing. With no type,
  // text, which converts to the type it meets.
  literal(v, t) {
    if (v === null) return `CAST(NULL AS ${this.type(t) ?? 'VARCHAR(1)'})`;
    return super.literal(v, t);
  }
  datetime(v) { return /\d:\d/.test(v) ? `CAST(${this.str(v)} AS DATETIME2(6))` : `CAST(${this.str(v)} AS DATE)`; }
  type(t) {
    return { int: 'BIGINT', double: 'FLOAT', decimal: 'DECIMAL(19,4)', string: 'VARCHAR(8000)', bool: 'BIT', datetime: 'DATETIME2(6)' }[t];
  }
  div(a, b) { return `(${fl(a)} / NULLIF(${b}, 0))`; }
  // OFFSET needs an ORDER BY: none, when the query has none.
  limit(n, offset, ordered = false) {
    if (n == null && !offset) return '';
    return `${ordered ? '' : ' ORDER BY (SELECT NULL)'} OFFSET ${offset ?? 0} ROWS${n != null ? ` FETCH NEXT ${n} ROWS ONLY` : ''}`;
  }

  // A value more than a column or a constant, written once in a row the body reads, as the
  // CASE's branches are (emit.js): (SELECT body FROM (SELECT x AS "v0") AS b1). An aggregate
  // over the rows around it can't be in a subquery: as it is.
  bind(vals, body) {
    const at = vals.map((v, i) => (v == null || plain(v) ? -1 : i)).filter(i => i >= 0);
    if (!at.length || !this.alias || vals.some(v => v != null && aggregates(v))) return body(...vals);
    const b = this.alias('b');
    const refs = vals.map((v, i) => (at.includes(i) ? `${b}.${this.ident(`v${i}`)}` : v));
    return `(SELECT ${body(...refs)} FROM (SELECT ${at.map(i => `${vals[i]} AS ${this.ident(`v${i}`)}`).join(', ')}) AS ${b})`;
  }

  cond(v) { return `(${v} = 1)`; }
  value(c) { return `CASE WHEN ${c} THEN CAST(1 AS BIT) WHEN NOT (${c}) THEN CAST(0 AS BIT) END`; }
  orFalse(c) { return `(CASE WHEN ${c} THEN 1 ELSE 0 END = 1)`; }
  get always() { return '1 = 1'; }
  get never() { return '1 = 0'; }

  // A blank sorts first ascending and last descending as it is; the other way round, by a key first.
  order(v, dir, nulls) {
    if ((dir === 'ASC') === (nulls === 'FIRST')) return `${v} ${dir}`;
    return `CASE WHEN ${v} IS NULL THEN ${nulls === 'FIRST' ? 0 : 1} ELSE ${nulls === 'FIRST' ? 1 : 0} END, ${v} ${dir}`;
  }
  windowOrder(terms) { return `ORDER BY ${terms.length ? terms.join(', ') : '(SELECT NULL)'}`; }
  lateral(sql, alias, outer) { return ` ${outer ? 'OUTER' : 'CROSS'} APPLY (${sql}) AS ${alias}`; }

  // Fabric decorrelates a correlated subquery under ISNULL, but not under COALESCE, which it
  // writes as a CASE that names the subquery twice: a RANKX of 121 rows took 107 s, and 250 ms
  // with ISNULL. So COALESCE((SELECT ...), <a blank>) is ISNULL; ISNULL takes the type of the
  // subquery, which a blank's 0, '', FALSE or day zero keep. Any other COALESCE stays.
  finish(sql) {
    const blanks = new Set(['0', "''", 'CAST(0 AS BIT)', "CAST('1899-12-30' AS DATE)"]);
    const at = [];
    for (const m of sql.matchAll(/\bCOALESCE\(/g)) {
      const args = callArgs(sql, m.index + m[0].length);
      if (args?.length === 2 && /^\(\s*SELECT\b/i.test(args[0]) && closes(args[0]) && blanks.has(args[1])) at.push(m.index);
    }
    let out = sql;
    for (const i of at.reverse()) out = `${out.slice(0, i)}ISNULL${out.slice(i + 'COALESCE'.length)}`;
    return out;
  }

  blankOf(t) {
    if (t === 'bool') return 'CAST(0 AS BIT)';
    if (t === 'datetime' || t === 'date') return "CAST('1899-12-30' AS DATE)";
    return super.blankOf(t);
  }

  // As DAX converts: 3.0 as "3", 0.1 + 0.2 as "0.3" (15 digits), 1E+20; a date as 1/5/2024, with
  // the time when it is not midnight; TRUE as "TRUE".
  text(sql, t) {
    if (t === 'double' || t === 'decimal') return `FORMAT(${fl(sql)}, 'G15')`;
    if (t === 'datetime' || t === 'date') return this.bind([sql], sql => {
      const ts = `CAST(${sql} AS DATETIME2(6))`;
      return `CASE WHEN ${ts} = CAST(CAST(${sql} AS DATE) AS DATETIME2(6)) THEN FORMAT(${ts}, 'M/d/yyyy', 'en-US')
        WHEN CAST(${sql} AS DATE) = CAST('1899-12-30' AS DATE) THEN FORMAT(${ts}, 'h:mm:ss tt', 'en-US')
        ELSE FORMAT(${ts}, 'M/d/yyyy h:mm:ss tt', 'en-US') END`;
    });
    if (t === 'bool') return `CASE ${sql} WHEN 1 THEN 'TRUE' WHEN 0 THEN 'FALSE' END`;
    return `CAST(${sql} AS VARCHAR(8000))`;
  }

  paths() { throw unsupported('PATH on the SQL endpoint (it has no recursive CTE)'); }

  series(start, end, step, t) {
    const n = `CAST(FLOOR(${fl(`(${end}) - (${start})`)} / (${step}) + 1e-9) AS BIGINT)`;
    if (t === 'datetime') {
      const days = `CAST(FLOOR(${fl(`DATEDIFF(DAY, ${start}, ${end})`)} / (${step}) + 1e-9) AS BIGINT)`;
      return `(SELECT CAST(DATEADD(DAY, CAST(value * (${step}) AS INT), CAST(${start} AS DATETIME2(6))) AS DATE) AS v FROM GENERATE_SERIES(CAST(0 AS BIGINT), ${days}))`;
    }
    if (t === 'int') return `(SELECT value AS v FROM GENERATE_SERIES(CAST(${start} AS BIGINT), CAST(${end} AS BIGINT), CAST(${step} AS BIGINT)))`;
    return `(SELECT ${start} + ${step} * value AS v FROM GENERATE_SERIES(CAST(0 AS BIGINT), ${n}))`;
  }

  fn(name, a, nodes = []) {
    const TEXT = { left: [0], right: [0], mid: [0], len: [0], upper: [0], lower: [0], trim: [0], substitute: [0, 1, 2], replace: [0, 3],
      search: [0, 1], find: [0, 1], rept: [0], exact: [0, 1], unicode: [0], containsstring: [0, 1], containsstringexact: [0, 1],
      pathlength: [0], pathitem: [0], pathitemreverse: [0], pathcontains: [0, 1] };
    if (TEXT[name]) a = a.map((v, i) => (TEXT[name].includes(i) && nodes[i] && nodes[i].t !== 'string' && nodes[i].t !== 'blank' ? this.text(v, nodes[i].t) : v));
    const [x, y, z, w] = a;
    switch (name) {
      case 'isblank': return `(${x} IS NULL)`;
      case 'coalesce': return `COALESCE(${a.join(', ')})`;
      case 'greatest': return `GREATEST(${a.join(', ')})`;
      case 'least': return `LEAST(${a.join(', ')})`;
      case 'divide': return a.length === 2 ? `(${fl(x)} / NULLIF(${y}, 0))`
        : this.bind([x, y, z], (x, y, z) => `CASE WHEN COALESCE(${y}, 0) = 0 THEN ${z} ELSE ${fl(x)} / ${y} END`);
      case 'iseven': return `(CAST(ROUND(${x}, 0, 1) AS BIGINT) % 2 = 0)`;
      case 'isodd': return `(CAST(ROUND(${x}, 0, 1) AS BIGINT) % 2 <> 0)`;
      // An error that has the type of the branch it is in: text is the lowest of the types.
      case 'error': return `CAST(CAST(${x} AS INT) AS VARCHAR(1))`;
      // math
      case 'abs': return `ABS(${x})`;
      case 'sign': return `SIGN(${x})`;
      case 'sqrt': return `SQRT(${x})`;
      case 'exp': return `EXP(${x})`;
      case 'ln': return `LOG(${x})`;
      case 'log10': return `LOG10(${x})`;
      case 'log': return `(LOG(${x}) / LOG(${y}))`;
      case 'power': return `POWER(${fl(x)}, ${y})`;
      case 'mod': return this.bind([x, y], (x, y) => `(${x} - ${y} * FLOOR(${fl(x)} / ${y}))`);
      case 'quotient': return `CAST(ROUND(${fl(x)} / ${y}, 0, 1) AS BIGINT)`;
      case 'round': return `ROUND(${x}, ${int(y)})`;
      // A fixed decimal: four places, rounded from the value's decimal digits (a FLOAT's ROUND sees
      // 0.50005 as 0.50004999...), within a 64-bit count of ten-thousandths.
      case 'currency': return this.bind([x], x => `CASE WHEN ABS(${x}) >= 922337203685477.5808
        THEN ${this.fn('error', [this.str('DAX: the result of a conversion or arithmetic operation is too large or too small for a fixed decimal number')])}
        ELSE CAST(ROUND(CAST(${x} AS DECIMAL(38,12)), 4) AS DECIMAL(19,4)) END`);
      case 'roundup': return this.bind([x, y], (x, y) => `(SIGN(${x}) * CEILING(ABS(${x}) * POWER(10e0, ${y})) / POWER(10e0, ${y}))`);
      case 'rounddown': case 'trunc': return this.bind([x, y], (x, y) => `(ROUND(${x} * POWER(10e0, ${y}), 0, 1) / POWER(10e0, ${y}))`);
      case 'int': return `CAST(FLOOR(${x}) AS BIGINT)`;
      case 'ceiling': return y ? `(CEILING(${fl(x)} / ${y}) * ${y})` : `CEILING(${x})`;
      case 'floor': return y ? `(FLOOR(${fl(x)} / ${y}) * ${y})` : `FLOOR(${x})`;
      case 'mround': return `(ROUND(${fl(x)} / ${y}, 0) * ${y})`;
      case 'rand': return 'RAND(CHECKSUM(NEWID()))';
      case 'randbetween': return `CAST(FLOOR(RAND(CHECKSUM(NEWID())) * (${y} - ${x} + 1)) + ${x} AS BIGINT)`;
      case 'even': return `CAST(SIGN(${x}) * CEILING(ABS(${fl(x)}) / 2) * 2 AS BIGINT)`;
      case 'odd': return `CAST(SIGN(${x}) * (CEILING((ABS(${fl(x)}) + 1) / 2) * 2 - 1) AS BIGINT)`;
      case 'value': return `CAST(${x} AS FLOAT)`;
      case 'cast': return this.cast(x, JSON.parse(y.replace(/^'|'$/g, '"')));
      // text
      case 'left': return `LEFT(${x}, ${y ?? 1})`;
      case 'right': return `RIGHT(${x}, ${y ?? 1})`;
      case 'mid': return `SUBSTRING(${x}, ${y}, ${z})`;
      // LEN leaves out trailing spaces, so they are counted as dots; a blank stays blank (NULL + 'x'
      // is 'x' on Fabric's connection).
      case 'len': return `LEN(REPLACE(${x}, ' ', '.'))`;
      case 'upper': return `UPPER(${x})`;
      case 'lower': return `LOWER(${x})`;
      case 'trim': return `REGEXP_REPLACE(TRIM(${x}), ' {2,}', ' ')`;
      case 'substitute':
        if (w === undefined) return `REPLACE(${x} COLLATE ${BIN}, ${y}, ${z})`;
        throw unsupported('SUBSTITUTE with an instance number on the SQL endpoint');
      case 'replace': return `(LEFT(${x}, ${y} - 1) || ${w} || SUBSTRING(${x}, ${y} + ${z}, 2147483647))`;
      case 'search': case 'find': return this.bind([x, y, z, w], (x, y, z, w) => {
        const s = v => (name === 'search' ? `LOWER(${v})` : `${v} COLLATE ${BIN}`);
        const pos = `CHARINDEX(${s(`COALESCE(${x}, '')`)}, ${s(`COALESCE(${y}, '')`)}, ${z})`;
        // = takes " " for "": the text's length says whether it is empty.
        return `CASE WHEN DATALENGTH(COALESCE(${x}, '')) = 0 THEN ${z} WHEN ${pos} = 0 THEN ${w} ELSE ${pos} END`;
      });
      case 'rept': return `REPLICATE(${x}, ${int(y)})`;
      // The lengths as one type: a constant with a letter outside ASCII is an NVARCHAR, two bytes a
      // letter, beside a column's UTF-8.
      case 'exact': return this.bind([x, y], (x, y) => `(COALESCE(${x}, '') COLLATE ${BIN} = COALESCE(${y}, '') AND DATALENGTH(CAST(COALESCE(${x}, '') AS NVARCHAR(4000))) = DATALENGTH(CAST(COALESCE(${y}, '') AS NVARCHAR(4000))))`);
      case 'unichar': return `NCHAR(${int(x)})`;
      case 'unicode': return `UNICODE(${x})`;
      case 'containsstring': return `(DATALENGTH(COALESCE(${y}, '')) = 0 OR CHARINDEX(LOWER(COALESCE(${y}, '')), LOWER(COALESCE(${x}, ''))) > 0)`;
      case 'containsstringexact': return `(DATALENGTH(COALESCE(${y}, '')) = 0 OR CHARINDEX(COALESCE(${y}, '') COLLATE ${BIN}, COALESCE(${x}, '')) > 0)`;
      // A path's items: "" is a path of none, and a blank path's length is blank; a position past
      // either end is blank.
      // The separators counted in letters (each written twice is one letter more), not in bytes:
      // a constant with a letter outside ASCII is two bytes a letter.
      case 'pathlength': return `CASE WHEN ${x} = '' THEN 0 ELSE LEN(REPLACE(${x}, '|', '||')) - LEN(${x}) + 1 END`;
      case 'pathitem': return `(SELECT value FROM STRING_SPLIT(NULLIF(${x}, ''), '|', 1) WHERE ordinal = ${y})`;
      case 'pathitemreverse': return `(SELECT value FROM STRING_SPLIT(NULLIF(${x}, ''), '|', 1) WHERE ordinal = LEN(REPLACE(${x}, '|', '||')) - LEN(${x}) + 2 - ${y})`;
      case 'pathcontains': return `(NULLIF(${x}, '') IS NOT NULL AND CHARINDEX('|' || ${y} || '|' COLLATE ${BIN}, '|' || ${x} || '|') > 0)`;
      case 'combinevalues': return `CONCAT_WS(${x}, ${a.slice(1).map((v, i) => `COALESCE(${nodes[i + 1] ? this.text(v, nodes[i + 1].t) : `CAST(${v} AS VARCHAR(8000))`}, '')`).join(', ')})`;
      case 'format_date': case 'format_number': throw unsupported('FORMAT on the SQL endpoint');
      case 'date_serial': return `(${fl(`DATEDIFF_BIG(MICROSECOND, ${DAY0}, CAST(${x} AS DATETIME2(6)))`)} / 86400000000)`;
      case 'serial_date': return `DATEADD(MILLISECOND, CAST(ROUND((${fl(x)} - FLOOR(${x})) * 86400000, 0) AS INT), DATEADD(DAY, CAST(FLOOR(${x}) AS INT), ${DAY0}))`;
      // dates
      case 'date': return `CAST(DATEADD(DAY, ${int(z)} - 1, DATEADD(MONTH, ${int(y)} - 1, DATEFROMPARTS(${int(x)}, 1, 1))) AS DATE)`;
      // A time is a date and time on day zero (1899-12-30), as in DAX.
      // Hours past 23, minutes and seconds past 59 carry, and the day they make is dropped.
      case 'time': return `DATEADD(MILLISECOND, CAST(CAST(ROUND((${x} * 3600 + ${y} * 60 + ${fl(z)}) * 1000, 0) AS BIGINT) % 86400000 AS INT), ${DAY0})`;
      // A date and time plus another: the second's time since day zero added to the first.
      case 'add_datetimes': return this.bind([x, y], (x, y) => {
        const T = v => `COALESCE(CAST(${v} AS DATETIME2(6)), ${DAY0})`;
        return `CASE WHEN ${x} IS NULL AND ${y} IS NULL THEN NULL ELSE DATEADD(MILLISECOND, DATEDIFF(MILLISECOND, CAST(CAST(${T(y)} AS DATE) AS DATETIME2(6)), ${T(y)}),
          DATEADD(DAY, DATEDIFF(DAY, ${DAY0}, ${T(y)}), ${T(x)})) END`;
      });
      case 'year': case 'month': case 'day': return `${name.toUpperCase()}(${x})`;
      case 'hour': case 'minute': case 'second': case 'quarter': return `DATEPART(${name.toUpperCase()}, ${x})`;
      case 'weekday': return this.bind([x, y], (x, y) => `CASE ${int(y)} WHEN 2 THEN ${isodow(x)} WHEN 3 THEN ${isodow(x)} - 1 ELSE ${dow(x)} + 1 END`);
      case 'weeknum': return this.bind([x, y], (x, y) => {
        const jan1 = `DATEFROMPARTS(YEAR(${x}), 1, 1)`;
        return `CASE WHEN ${int(y)} = 21 THEN DATEPART(ISO_WEEK, ${x})
        WHEN ${int(y)} = 2 THEN CAST(FLOOR((DATEPART(DAYOFYEAR, ${x}) - 1 + ${isodow(jan1)} - 1) / 7.0) + 1 AS BIGINT)
        ELSE CAST(FLOOR((DATEPART(DAYOFYEAR, ${x}) - 1 + ${dow(jan1)}) / 7.0) + 1 AS BIGINT) END`;
      });
      case 'eomonth': return `EOMONTH(${x}, ${int(y)})`;
      case 'add_interval': {
        const u = unit(z);
        if (u === 'WEEK') return `DATEADD(DAY, 7 * ${int(y)}, ${x})`;
        return `DATEADD(${u}, ${int(y)}, ${x})`;
      }
      // DATEDIFF counts weeks that start on Sunday, as DAX does.
      case 'datediff': return `DATEDIFF_BIG(${unit(z)}, ${x}, ${y})`;
      case 'start_of': return `CAST(DATETRUNC(${unit(y)}, ${x}) AS DATE)`;
      case 'end_of': {
        const u = unit(y);
        if (u === 'MONTH') return `EOMONTH(${x})`;
        if (u === 'DAY') return `CAST(${x} AS DATE)`;
        return `CAST(DATEADD(DAY, -1, DATEADD(MONTH, ${u === 'YEAR' ? 12 : 3}, DATETRUNC(${u}, ${x}))) AS DATE)`;
      }
      case 'today': return 'CAST(GETDATE() AS DATE)';
      case 'now': return 'CAST(SYSDATETIME() AS DATETIME2(6))';
      case 'utctoday': return 'CAST(SYSUTCDATETIME() AS DATE)';
      case 'utcnow': return 'CAST(SYSUTCDATETIME() AS DATETIME2(6))';
      // A row of values, for counting distinct rows: one text key, each value marked as blank or
      // not and written exactly (a number to its 17 digits, a date to the microsecond).
      case 'row': return `CONCAT(${a.map((v, i) => {
        const t = nodes[i]?.t;
        const s = t === 'double' || t === 'decimal' ? `CONVERT(VARCHAR(40), ${fl(v)}, 3)`
          : t === 'datetime' || t === 'date' ? `CONVERT(VARCHAR(40), CAST(${v} AS DATETIME2(6)), 126)` : `CAST(${v} AS VARCHAR(8000))`;
        return `CASE WHEN ${v} IS NULL THEN 'n' ELSE 'v' || ${s} END`;
      }).join(', CHAR(31), ')})`;
      // A fixed decimal over a whole number: the exact quotient of ten-thousandths, rounded half
      // away from zero. Over 0 (or, for /, a blank): DIVIDE's alternate, or blank for / (T-SQL
      // has no infinity).
      case 'cydiv': case 'cydivide': return this.bind([x, y, z], (x, y, z) => {
        const n = `CAST(ROUND(${x} * 10000, 0) AS DECIMAL(38,0))`, d = `CAST(${y} AS DECIMAL(38,0))`;
        const zero = name === 'cydiv' ? 'NULL' : z ?? 'NULL';
        return `CASE WHEN COALESCE(${y}, 0) = 0 THEN ${zero}
          ELSE CAST(SIGN(${n}) * SIGN(${d}) * FLOOR((2 * ABS(${n}) + ABS(${d})) / (2 * ABS(${d}))) / 10000 AS DECIMAL(19,4)) END`;
      });
      case 'fact': case 'gcd': case 'lcm':
        throw unsupported(`${name.toUpperCase()} on the SQL endpoint`);
    }
    return super.fn(name, a);
  }

  // No FILTER: an aggregate over the rows a condition keeps is over a CASE that is blank for the others.
  agg(fn, x, extra = {}) {
    const f = extra.filter;
    const only = v => (f ? `CASE WHEN ${f} THEN ${v} END` : v);
    // Fabric adds up FLOATs in parallel, in an order of its own each time, so one measure written
    // twice (a RANKX's row and the rows it ranks) can differ in its last digit: 186445.7199999998
    // and 186445.72, and the row ranks below itself. A DECIMAL's sum is the same in any order.
    const exact = v => `CAST(${v} AS DECIMAL(38,15))`;
    switch (fn) {
      // A whole number's sum as 64 bits: SUM of an INT column is an INT, and overflows as one.
      case 'sum': return extra.t === 'double' ? `CAST(SUM(${exact(only(x))}) AS FLOAT)` : extra.t === 'int' ? `SUM(CAST(${only(x)} AS BIGINT))` : `SUM(${only(x)})`;
      case 'avg': return extra.t === 'double' ? `CAST(AVG(${exact(only(x))}) AS FLOAT)` : `AVG(${fl(only(x))})`;
      case 'min': return `MIN(${only(x)})`;
      case 'max': return `MAX(${only(x)})`;
      case 'count': return `NULLIF(COUNT_BIG(${only(x)}), 0)`;
      case 'count0': return `COUNT_BIG(${only(x)})`;
      case 'countrows': return f ? `NULLIF(COUNT_BIG(${only(1)}), 0)` : 'NULLIF(COUNT_BIG(*), 0)';
      // DAX counts a blank as a value.
      case 'dcount': return `(COUNT_BIG(DISTINCT ${only(x)}) + MAX(${only(`CASE WHEN ${x} IS NULL THEN 1 ELSE 0 END`)}))`;
      case 'dcount0': return `COUNT_BIG(DISTINCT ${only(x)})`;
      case 'dcountnb': return `NULLIF(COUNT_BIG(DISTINCT ${only(x)}), 0)`;
      case 'countblank': return `NULLIF(COUNT_BIG(CASE WHEN ${x} IS NULL${f ? ` AND ${f}` : ''} THEN 1 END), 0)`;
      case 'hasone': return `CASE WHEN COUNT_BIG(DISTINCT ${only(x)}) + MAX(${only(`CASE WHEN ${x} IS NULL THEN 1 ELSE 0 END`)}) = 1 THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END`;
      case 'product': return `PRODUCT(${only(x)})`;
      case 'median': return `MEDIAN(${only(x)})`;
      case 'stdev_s': return `STDEV(${only(x)})`;
      case 'stdev_p': return `STDEVP(${only(x)})`;
      case 'var_s': return `VAR(${only(x)})`;
      case 'var_p': return `VARP(${only(x)})`;
      case 'concat': return `STRING_AGG(CAST(${only(`COALESCE(${x}, '')`)} AS VARCHAR(MAX)), ${extra.delim})${extra.order?.length ? ` WITHIN GROUP (ORDER BY ${extra.order.join(', ')})` : ''}`;
      // PERCENTILE.INC is PERCENTILE_CONT, over the column's values (its blanks left out).
      case 'pct_inc':
        if (!/^[\d.]+$/.test(String(extra.k).trim())) throw unsupported('PERCENTILE.INC with a k that is not a number, on the SQL endpoint');
        return `PERCENTILE_CONT(${extra.k}) WITHIN GROUP (ORDER BY ${only(x)})`;
      case 'pct_exc': case 'pctx_inc': case 'pctx_exc': throw unsupported(`${fn} on the SQL endpoint`);
    }
    return super.agg(fn, x);
  }
}

// The arguments of the call whose ( is just before `i`, as trimmed SQL; null when it does not end.
// Strings and quoted names are skipped whole.
function callArgs(sql, i) {
  const args = [];
  let depth = 0, start = i;
  for (; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      const end = sql.indexOf(c, i + 1);
      if (end < 0) return null;
      i = end;   // '' and "" inside are two quoted runs back to back, skipped alike
    } else if (c === '(') depth++;
    else if (c === ')') {
      if (!depth--) { args.push(sql.slice(start, i).trim()); return args; }
    } else if (c === ',' && !depth) { args.push(sql.slice(start, i).trim()); start = i + 1; }
  }
  return null;
}

// SQL that is a column of a row or a constant, which bind() names as it is.
const plain = v => /^\w+\.(?:"(?:[^"]|"")*"|\w+)$/.test(v) || /^-?\d+(?:\.\d+)?(?:e[-+]?\d+)?$/i.test(v) || /^N?'(?:[^']|'')*'$/.test(v)
  || /^\(?CAST\((?:NULL|-?\d+(?:\.\d+)?|N?'(?:[^']|'')*') AS [\w(), ]+\)\)?$/i.test(v) || v === 'NULL';
// Whether SQL aggregates (or windows) the rows of the query it is in: outside its subqueries.
const AGG = /\b(?:SUM|COUNT|COUNT_BIG|MIN|MAX|AVG|STRING_AGG|STDEV|STDEVP|VAR|VARP|PRODUCT|MEDIAN|PERCENTILE_CONT|GROUPING)\s*\(|\bOVER\s*\(/i;
function aggregates(sql) {
  let out = '', depth = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      const end = sql.indexOf(c, i + 1);
      if (end < 0) break;
      i = end;   // a string or a quoted name: neither aggregates
    } else if (depth) {
      if (c === '(') depth++;
      else if (c === ')') depth--;
    } else if (c === '(' && /^\(\s*SELECT\b/i.test(sql.slice(i, i + 12))) depth = 1;
    else out += c;
  }
  return AGG.test(out);
}

// Whether SQL that starts with ( is that one parenthesis and what it holds.
function closes(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"') { i = s.indexOf(c, i + 1); if (i < 0) return false; }
    else if (c === '(') depth++;
    else if (c === ')' && !--depth) return i === s.length - 1;
  }
  return false;
}

function unit(sqlStr) {
  const u = UNIT_SQL[String(sqlStr).replace(/'/g, '').toLowerCase()];
  if (!u) throw new Error(`unknown unit ${sqlStr}`);
  return u;
}
