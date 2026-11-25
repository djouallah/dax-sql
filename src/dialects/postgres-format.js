// FORMAT on PostgreSQL: what format.js reads a pattern into, as SQL. The same rules as
// duckdb-format.js, written with what PostgreSQL has: to_char for the 15 significant digits
// (9.99999999999999EEEE, as DuckDB's printf %.14e) and for dates, arrays for nothing.
//
// A value is bound once (bind: a subquery's row the body reads); one that aggregates or windows
// the rows around it is written in place instead, as a subquery's own COUNT(*) would count its
// one row (sqlAggregates).

const q = s => `'${String(s).replace(/'/g, "''")}'`;
const cat = parts => (parts.length ? (parts.length === 1 ? parts[0] : `(${parts.join(' || ')})`) : "''");

// SQL's text with each of `name` replaced by (value) where value aggregates, else a row of it.
export function bindAs(name, value, body) {
  if (sqlAggregates(value)) return body.replace(new RegExp(`\\b${name}\\b`, 'g'), `(${value})`);
  return `(SELECT ${body} FROM (SELECT ${value} AS ${name}) AS ${name}_b)`;
}
const bind = bindAs;

// Whether SQL aggregates or windows the rows of the query it is in: outside its subqueries.
const AGG = /\b(?:SUM|COUNT|MIN|MAX|AVG|STRING_AGG|ARRAY_AGG|STDDEV_SAMP|STDDEV_POP|VAR_SAMP|VAR_POP|PERCENTILE_CONT|PERCENTILE_DISC|BOOL_OR|BOOL_AND|EVERY|GROUPING)\s*\(|\bOVER\s*\(/i;
export function sqlAggregates(sql) {
  let out = '', depth = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      const end = sql.indexOf(c, i + 1);
      if (end < 0) break;
      i = end;
    } else if (depth) {
      if (c === '(') depth++;
      else if (c === ')') depth--;
    } else if (c === '(' && /^\(\s*SELECT\b/i.test(sql.slice(i, i + 12))) depth = 1;
    else out += c;
  }
  return AGG.test(out);
}

// m (>= 0, or any number) to 15 significant digits in scientific notation, as DuckDB's
// printf('%.14e'): 1.23450000000000e+03.
export const e14 = m => `trim(to_char(CAST(${m} AS DOUBLE PRECISION), '9.99999999999999EEEE'))`;
// The same digits for Polars, which has no to_char of a number: the mantissa rounded to 14 places
// (ROUND's places a constant on Polars), as Polars writes a double (its shortest form: 1.2345,
// 1.0), 'e', the exponent (one more when the mantissa rounds up to 10). The exponent a double's:
// Polars reads a negative whole one as unsigned.
const e14Polars = x => {
  const v = `CAST(${x} AS DOUBLE PRECISION)`, e0 = `CAST(floor(log10(abs(${v}))) AS BIGINT)`;
  const m0 = `round(${v} / power(10.0, CAST(${e0} AS DOUBLE PRECISION)), 14)`;
  return `CASE WHEN ${v} = 0 THEN '0.0e0' ELSE CAST(CASE WHEN abs(${m0}) >= 10 THEN round(${m0} / 10, 14) ELSE ${m0} END AS TEXT)
    || 'e' || CAST(CASE WHEN abs(${m0}) >= 10 THEN ${e0} + 1 ELSE ${e0} END AS TEXT) END`;
};

// --- numbers ---------------------------------------------------------------------------

// A value as DAX's General Number writes it (15 significant digits, 1E+20 beyond them): C's
// %.15g, upper case. For Polars (polars: true): its digits as e14Polars writes them, the value
// written where it is read, not bound in
// a row of its own (Polars reads no outer row in a derived table: pola-rs/polars#31067), and its
// trailing zeros trimmed as text (Polars has no trim_scale: the 15 digits as DECIMAL(38,18),
// exactly, as the exponents -4 to 14 need).
export function generalNumber(x, t, polars = false) {
  if (t === 'int') return `CAST(${x} AS TEXT)`;
  if (t === 'bool') return `CASE ${x} WHEN TRUE THEN 'True' WHEN FALSE THEN 'False' END`;
  const ex = `CAST(split_part(dax_ge, 'e', 2) AS INTEGER)`;
  const sci = `rtrim(rtrim(split_part(dax_ge, 'e', 1), '0'), '.') || 'E' || CASE WHEN ${ex} < 0 THEN '-' ELSE '+' END || lpad(CAST(abs(${ex}) AS TEXT), 2, '0')`;
  // (Polars computes a CASE's branches no row takes too: the cast sees only exponents -4 to 14.)
  const plain = polars ? `rtrim(rtrim(CAST(CAST(CASE WHEN ${ex} BETWEEN -4 AND 14 THEN dax_ge END AS DECIMAL(38,18)) AS TEXT), '0'), '.')` : `CAST(trim_scale(CAST(dax_ge AS NUMERIC)) AS TEXT)`;
  return (polars ? (n, v, body) => body.replaceAll(n, `(${v})`) : bind)('dax_ge', (polars ? e14Polars : e14)(x), `CASE WHEN dax_ge IS NULL THEN NULL WHEN ${ex} < -4 OR ${ex} >= 15 THEN ${sci}
    ELSE ${plain} END`);
}

// m >= 0 rounded to n places, as text with n decimals ("1234.50").
function digits(m, n, whole) {
  const zeros = n ? ` || '.${'0'.repeat(n)}'` : '';
  if (whole) return `(CAST(${m} AS TEXT)${zeros})`;
  const e = e14(m);
  // Beyond 15 digits there is no fraction left: the 15 digits, then zeros.
  return `CASE WHEN ${m} < 1e15 THEN CAST(round(CAST(${e} AS NUMERIC(38,22)), ${n}) AS TEXT)
    ELSE replace(split_part(${e}, 'e', 1), '.', '') || repeat('0', CAST(split_part(${e}, 'e', 2) AS INTEGER) - 14)${zeros} END`;
}
const rounded = (m, n) => `CASE WHEN ${m} < 1e15 THEN round(CAST(${e14(m)} AS NUMERIC(38,22)), ${n}) ELSE ${m} END`;

const hasDigits = sec => sec.nInt + sec.nFrac + sec.nExp > 0 || sec.point;
const isWhole = (sec, t) => t === 'int' && !sec.scale && !sec.sci;
function scaled(sec, a) {
  const up = 100 ** sec.pct, down = 1000 ** sec.scale;
  if (up === 1 && down === 1) return a;
  return `(CAST(${a} AS DOUBLE PRECISION)${up > 1 ? ` * ${up}` : ''}${down > 1 ? ` / ${down}` : ''})`;
}

// Whether a >= 0 shows as zero in the section (the negative one, then, shows the zero one).
function roundsToZero(sec, a, t) {
  if (!hasDigits(sec)) return 'FALSE';
  if (sec.sci) return `(${a} = 0)`;
  const m = scaled(sec, a);
  return isWhole(sec, t) ? `(${m} = 0)` : `(${rounded(m, sec.nFrac)} = 0)`;
}

// a >= 0 in one section.
function section(sec, a, t) {
  if (!hasDigits(sec)) return cat(sec.tokens.filter(x => x.t === 'lit').map(x => q(x.v)));
  const m = scaled(sec, a), n = sec.nFrac;
  if (!sec.sci) return bind('dax_fr', digits(m, n, isWhole(sec, t)), assemble(sec, 'dax_fr', null));
  // The exponent puts nInt digits before the point; one more when rounding carries (9.996 -> 10.00).
  const k = Math.max(sec.nInt, 1);
  const e0 = `CASE WHEN ${m} = 0 THEN 0 ELSE CAST(floor(log(CAST(${m} AS DOUBLE PRECISION))) AS INTEGER) - ${k - 1} END`;
  const e = `dax_fe0 + CASE WHEN ${m} > 0 AND ${rounded(`${m} / power(10, dax_fe0)`, n)} >= ${10 ** k} THEN 1 ELSE 0 END`;
  return bind('dax_fe0', e0, bind('dax_fe', e, bind('dax_fr', digits(`${m} / power(10, dax_fe)`, n, false), assemble(sec, 'dax_fr', 'dax_fe'))));
}

// The section's text from r, the rounded digits ("1234.50"), and e, the exponent.
function assemble(sec, r, e) {
  const n = sec.nFrac;
  const int = n ? `split_part(${r}, '.', 1)` : r;
  let d = `CASE WHEN ${int} = '0' THEN '' ELSE ${int} END`;   // "#.##" shows 0.5 as .5
  if (sec.nZeroInt) d = `lpad(${d}, CAST(greatest(length(${d}), ${sec.nZeroInt}) AS INTEGER), '0')`;
  if (sec.thousands && !sec.interleaved) d = `reverse(rtrim(regexp_replace(reverse(${d}), '(\\d{3})', '\\1,', 'g'), ','))`;
  let frac = `split_part(${r}, '.', 2)`;
  if (n > sec.nZeroFrac) frac = `regexp_replace(${frac}, '0{0,${n - sec.nZeroFrac}}$', '')`;
  const D = sec.interleaved ? 'dax_fd' : d;
  const parts = [];
  let intDone = false, fracDone = false, expDone = false, i = 0;
  const int0 = () => { if (!intDone) parts.push(D); intDone = true; };
  for (const x of sec.tokens) {
    if (x.t === 'lit') parts.push(q(x.v));
    else if (x.t === 'int' && sec.interleaved) {
      // Digits fill the placeholders from the right; the first takes the rest.
      const j = sec.nInt - 1 - i++;
      parts.push(j === sec.nInt - 1 ? `left(${D}, greatest(length(${D}) - ${j}, 0))`
        : `CASE WHEN length(${D}) > ${j} THEN substr(${D}, length(${D}) - ${j}, 1) ELSE '' END`);
      intDone = true;
    } else if (x.t === 'int') int0();
    else if (x.t === 'point') { int0(); parts.push("'.'"); }
    else if (x.t === 'frac') { if (!fracDone) parts.push(frac); fracDone = true; }
    else if (x.t === 'exp') {
      int0();
      parts.push(q(sec.sci.upper ? 'E' : 'e'), `CASE WHEN ${e} < 0 THEN '-' ELSE '${sec.sci.plus ? '+' : ''}' END`);
    } else if (x.t === 'expd' && !expDone) {
      const ae = `CAST(abs(${e}) AS TEXT)`;
      parts.push(`lpad(${ae}, CAST(greatest(length(${ae}), ${sec.nExp}) AS INTEGER), '0')`);
      expDone = true;
    }
  }
  const body = cat(parts);
  return sec.interleaved ? bind('dax_fd', d, body) : body;
}

// FORMAT(number, pattern): spec from numberFormat; t the value's type.
export function formatNumber(x, spec, t) {
  if (spec.general) return `COALESCE(${generalNumber(x, t)}, '')`;
  if (t === 'bool') { x = `CAST(${x} AS INTEGER)`; t = 'int'; }
  if (spec.bool) return bind('dax_fv', x, `CASE WHEN dax_fv IS NULL THEN '' WHEN dax_fv <> 0 THEN ${q(spec.bool[0])} ELSE ${q(spec.bool[1])} END`);
  const vt = t === 'int' ? 'int' : 'double';
  const [pos, neg, zero] = spec.sections;
  const v = 'dax_fv', minus = `(-${v})`;
  // Zero takes the third section (the first when there is none); a negative value the second,
  // or the first with a minus sign, and the zero one when it rounds to zero.
  const z = section(zero ?? pos, vt === 'int' ? '0' : 'CAST(0 AS DOUBLE PRECISION)', vt);
  const negSec = neg ?? pos;
  const negText = `CASE WHEN ${roundsToZero(negSec, minus, vt)} THEN ${z} ELSE ${neg ? '' : "'-' || "}${section(negSec, minus, vt)} END`;
  const body = `CASE WHEN ${v} IS NULL THEN '' WHEN ${v} > 0 THEN ${section(pos, v, vt)} WHEN ${v} = 0 THEN ${z} ELSE ${negText} END`;
  return bind(v, vt === 'int' ? `CAST(${x} AS BIGINT)` : `CAST(${x} AS DOUBLE PRECISION)`, body);
}

// --- dates -------------------------------------------------------------------------------

// DAX's tokens as to_char's (FM: without padding, for the one pattern after it).
const TO_CHAR = {
  d: 'FMDD', dd: 'DD', ddd: 'Dy', dddd: 'FMDay', ddddd: 'FMMM/FMDD/YYYY', dddddd: 'FMDay, FMMonth FMDD, YYYY',
  m: 'FMMM', mm: 'MM', mmm: 'Mon', mmmm: 'FMMonth', y: 'FMDDD', yy: 'YY', yyyy: 'YYYY',
  h: 'FMHH24', hh: 'HH24', h12: 'FMHH12', hh12: 'HH12', n: 'FMMI', nn: 'MI', min: 'FMMI', mins: 'MI', s: 'FMSS', ss: 'SS',
  ttttt: 'FMHH12:MI:SS AM', 'AM/PM': 'AM', AMPM: 'AM',
};
// Text in a to_char pattern: in double quotes, where \ escapes " and \.
const quoted = s => `"${String(s).replace(/[\\"]/g, c => `\\${c}`)}"`;

// A date as DAX writes it by default: the date, with the time when it is not midnight.
export function generalDate(v) {
  return `CASE WHEN CAST(${v} AS TIMESTAMP) = CAST(CAST(${v} AS DATE) AS TIMESTAMP) THEN to_char(${v}, 'FMMM/FMDD/YYYY')
    WHEN CAST(${v} AS DATE) = DATE '1899-12-30' THEN to_char(${v}, 'FMHH12:MI:SS AM')
    ELSE to_char(${v}, 'FMMM/FMDD/YYYY FMHH12:MI:SS AM') END`;
}

// FORMAT(date, pattern): tokens from dateFormat.
export function formatDate(x, tokens) {
  const v = 'dax_fv', pieces = [];
  const sql = s => pieces.push({ s });
  for (const x of tokens) {
    if (x.t === 'lit') pieces.push({ f: quoted(x.v) });
    else if (TO_CHAR[x.t]) pieces.push({ f: TO_CHAR[x.t] });
    else if (x.t === 'w') sql(`CAST(CAST(EXTRACT(DOW FROM ${v}) AS INTEGER) + 1 AS TEXT)`);
    else if (x.t === 'ww') sql(`CAST(CAST(floor((EXTRACT(DOY FROM ${v}) - 1 + EXTRACT(DOW FROM make_date(CAST(EXTRACT(YEAR FROM ${v}) AS INTEGER), 1, 1))) / 7) AS BIGINT) + 1 AS TEXT)`);
    else if (x.t === 'q') sql(`CAST(EXTRACT(QUARTER FROM ${v}) AS TEXT)`);
    else if (x.t === 'am/pm') sql(`lower(to_char(${v}, 'AM'))`);
    else if (x.t === 'A/P') sql(`left(to_char(${v}, 'AM'), 1)`);
    else if (x.t === 'a/p') sql(`lower(left(to_char(${v}, 'AM'), 1))`);
    else if (x.t === 'c') sql(generalDate(v));
    else throw new Error(`FORMAT: date token ${x.t}`);
  }
  // Runs of to_char pieces in one call.
  const parts = [];
  for (const p of pieces) {
    if (p.f !== undefined && parts.length && parts.at(-1).f !== undefined) parts.at(-1).f += p.f;
    else parts.push({ ...p });
  }
  const body = cat(parts.map(p => (p.f !== undefined ? `to_char(${v}, ${q(p.f)})` : p.s)));
  return bind(v, `CAST(${x} AS TIMESTAMP)`, `CASE WHEN ${v} IS NULL THEN '' ELSE ${body} END`);
}

// A date's serial number (days since 1899-12-30), for a number pattern; and back.
export const dateSerial = x => `(EXTRACT(EPOCH FROM CAST(${x} AS TIMESTAMP)) / 86400 + 25569)`;
export const serialDate = x => `(TIMESTAMP '1899-12-30' + CAST(round(CAST(${x} AS NUMERIC) * 86400000000) AS BIGINT) * INTERVAL '1 microsecond')`;
