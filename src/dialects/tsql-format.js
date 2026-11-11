// FORMAT on T-SQL (Fabric): what format.js reads a pattern into, as SQL. The same rules as
// duckdb-format.js, written with what T-SQL has.
//
// `d` is the dialect: d.bind names a value once (a row the body reads), d.str writes a text
// constant, d.text a value as DAX's General format. Numbers are rounded as Excel and VB do: to
// 15 significant digits first (FORMAT's E14), then half away from zero at the decimal places
// the pattern shows, as a DECIMAL, so 1.005 with "0.00" is "1.01". The 15 digits become that
// DECIMAL as text, the point moved by the exponent: a product of two DECIMALs would keep six
// decimal places.

const cat = parts => (parts.length ? (parts.length === 1 ? parts[0] : `CONCAT(${parts.join(', ')})`) : "''");
const fl = x => `CAST(${x} AS FLOAT)`;
// Sunday is 0 (tsql.js).
const dow = x => `(DATEDIFF(DAY, CAST('1899-12-31' AS DATE), ${x}) % 7)`;

// --- numbers ---------------------------------------------------------------------------

// m >= 0 to 15 significant digits, as a DECIMAL (m below 1e15).
function exact(d, m, body) {
  return d.bind([`FORMAT(${fl(m)}, 'E14')`], e => {
    const digits = `REPLACE(LEFT(${e}, 16), '.', '')`, ex = `CAST(SUBSTRING(${e}, 18, 10) AS INT)`;
    const dec = `CAST(CASE WHEN ${ex} >= 0 THEN CONCAT(LEFT(${digits}, ${ex} + 1), '.', SUBSTRING(${digits}, ${ex} + 2, 15))
      WHEN ${ex} < -22 THEN '0' ELSE CONCAT('0.', REPLICATE('0', -${ex} - 1), ${digits}) END AS DECIMAL(38,22))`;
    return body(dec, digits, ex);
  });
}

// m >= 0 rounded to n places, as text with n decimals ("1234.50").
function digits(d, m, n, whole) {
  const zeros = n ? `'.${'0'.repeat(n)}'` : null;
  if (whole) return zeros ? `CONCAT(CAST(${m} AS VARCHAR(40)), ${zeros})` : `CAST(${m} AS VARCHAR(40))`;
  // Beyond 15 digits there is no fraction left: the 15 digits, then zeros.
  return exact(d, m, (dec, ds, ex) => `CASE WHEN ${m} < 1e15 THEN CAST(CAST(ROUND(${dec}, ${n}) AS DECIMAL(38,${n})) AS VARCHAR(60))
    ELSE CONCAT(${ds}, REPLICATE('0', ${ex} - 14)${zeros ? `, ${zeros}` : ''}) END`);
}
// Whether m >= 0 rounded to n places is at least `least` (0: whether it is not zero).
const reaches = (d, m, n, least) => exact(d, m, dec => `CASE WHEN ${m} >= 1e15 THEN 1 WHEN ROUND(${dec}, ${n}) ${least ? `>= ${least}` : '<> 0'} THEN 1 ELSE 0 END`);

const hasDigits = sec => sec.nInt + sec.nFrac + sec.nExp > 0 || sec.point;
const isWhole = (sec, t) => t === 'int' && !sec.scale && !sec.sci;
function scaled(sec, a) {
  const up = 100 ** sec.pct, down = 1000 ** sec.scale;
  if (up === 1 && down === 1) return a;
  return `(${fl(a)}${up > 1 ? ` * ${up}` : ''}${down > 1 ? ` / ${down}` : ''})`;
}

// Whether a >= 0 shows as zero in the section (the negative one, then, shows the zero one).
function roundsToZero(d, sec, a, t) {
  if (!hasDigits(sec)) return '1 = 0';
  if (sec.sci) return `${a} = 0`;
  const m = scaled(sec, a);
  return isWhole(sec, t) ? `${m} = 0` : `${reaches(d, m, sec.nFrac, 0)} = 0`;
}

// a >= 0 in one section.
function section(d, sec, a, t) {
  if (!hasDigits(sec)) return cat(sec.tokens.filter(x => x.t === 'lit').map(x => d.str(x.v)));
  const m = scaled(sec, a), n = sec.nFrac;
  if (!sec.sci) return d.bind([digits(d, m, n, isWhole(sec, t))], r => assemble(d, sec, r, null));
  // The exponent puts nInt digits before the point; one more when rounding carries (9.996 -> 10.00).
  const k = Math.max(sec.nInt, 1);
  const e0 = `CASE WHEN ${m} = 0 THEN 0 ELSE CAST(FLOOR(LOG10(${m})) AS INT) - ${k - 1} END`;
  return d.bind([e0], e0 => d.bind([`${e0} + CASE WHEN ${m} > 0 AND ${reaches(d, `(${fl(m)} / POWER(10e0, ${e0}))`, n, 10 ** k)} = 1 THEN 1 ELSE 0 END`],
    e => d.bind([digits(d, `(${fl(m)} / POWER(10e0, ${e}))`, n, false)], r => assemble(d, sec, r, e))));
}

// The section's text from r, the rounded digits ("1234.50"), and e, the exponent.
function assemble(d, sec, r, e) {
  const n = sec.nFrac;
  const int = n ? `LEFT(${r}, CHARINDEX('.', ${r}) - 1)` : r;
  // The integer digits: FORMAT pads them to the 0 placeholders and groups them by thousands;
  // with none ("#.##"), a zero is nothing (0.5 is .5).
  const shown = '0'.repeat(sec.nZeroInt) || '#';
  const net = p => `FORMAT(CAST(${int} AS DECIMAL(38,0)), '${p}', 'en-US')`;
  // Fabric's FORMAT writes a zero under "#" as 0.
  const whole = p => (sec.nZeroInt ? net(p) : `CASE WHEN ${int} = '0' THEN '' ELSE ${net(p)} END`);
  const grouped = whole(sec.thousands && !sec.interleaved ? `#,${shown}` : shown);
  let frac = `SUBSTRING(${r}, CHARINDEX('.', ${r}) + 1, 60)`;
  if (n > sec.nZeroFrac) frac = `REGEXP_REPLACE(${frac}, '0{0,${n - sec.nZeroFrac}}$', '')`;
  const build = D => {
    const parts = [];
    let intDone = false, fracDone = false, expDone = false, i = 0;
    const int0 = () => { if (!intDone) parts.push(D); intDone = true; };
    for (const x of sec.tokens) {
      if (x.t === 'lit') parts.push(d.str(x.v));
      else if (x.t === 'int' && sec.interleaved) {
        // Digits fill the placeholders from the right; the first takes the rest.
        const j = sec.nInt - 1 - i++;
        parts.push(j === sec.nInt - 1 ? `LEFT(${D}, CASE WHEN LEN(${D}) > ${j} THEN LEN(${D}) - ${j} ELSE 0 END)`
          : `CASE WHEN LEN(${D}) > ${j} THEN SUBSTRING(${D}, LEN(${D}) - ${j}, 1) ELSE '' END`);
        intDone = true;
      } else if (x.t === 'int') int0();
      else if (x.t === 'point') { int0(); parts.push("'.'"); }
      else if (x.t === 'frac') { if (!fracDone) parts.push(frac); fracDone = true; }
      else if (x.t === 'exp') {
        int0();
        parts.push(d.str(sec.sci.upper ? 'E' : 'e'), `CASE WHEN ${e} < 0 THEN '-' ELSE '${sec.sci.plus ? '+' : ''}' END`);
      } else if (x.t === 'expd' && !expDone) {
        parts.push(`FORMAT(ABS(${e}), '${'0'.repeat(sec.nExp)}')`);
        expDone = true;
      }
    }
    return cat(parts);
  };
  return sec.interleaved ? d.bind([grouped], build) : build(grouped);
}

// FORMAT(number, pattern): spec from numberFormat; t the value's type.
export function formatNumber(d, x, spec, t) {
  if (t === 'bool') {
    if (spec.general) return `COALESCE(CASE ${x} WHEN 1 THEN 'True' WHEN 0 THEN 'False' END, '')`;
    x = `CAST(${x} AS INT)`;
    t = 'int';
  }
  if (spec.general) return `COALESCE(${t === 'int' ? `CAST(${x} AS VARCHAR(40))` : d.text(x, 'double')}, '')`;
  if (spec.bool) return d.bind([x], v => `CASE WHEN ${v} IS NULL THEN '' WHEN ${v} <> 0 THEN ${d.str(spec.bool[0])} ELSE ${d.str(spec.bool[1])} END`);
  const vt = t === 'int' ? 'int' : 'double';
  const [pos, neg, zero] = spec.sections;
  // Zero takes the third section (the first when there is none); a negative value the second,
  // or the first with a minus sign, and the zero one when it rounds to zero.
  return d.bind([vt === 'int' ? `CAST(${x} AS BIGINT)` : fl(x)], v => {
    const minus = `(-${v})`, negSec = neg ?? pos;
    const z = section(d, zero ?? pos, vt === 'int' ? 'CAST(0 AS BIGINT)' : 'CAST(0 AS FLOAT)', vt);
    const negText = `CASE WHEN ${roundsToZero(d, negSec, minus, vt)} THEN ${z} ELSE ${neg ? section(d, negSec, minus, vt) : `CONCAT('-', ${section(d, negSec, minus, vt)})`} END`;
    return `CASE WHEN ${v} IS NULL THEN '' WHEN ${v} > 0 THEN ${section(d, pos, v, vt)} WHEN ${v} = 0 THEN ${z} ELSE ${negText} END`;
  });
}

// --- dates -------------------------------------------------------------------------------

// DAX's tokens as .NET's (FORMAT's).
const NET = {
  d: 'd', dd: 'dd', ddd: 'ddd', dddd: 'dddd', ddddd: 'M/d/yyyy', dddddd: 'dddd, MMMM d, yyyy',
  m: 'M', mm: 'MM', mmm: 'MMM', mmmm: 'MMMM', yy: 'yy', yyyy: 'yyyy',
  h: 'H', hh: 'HH', h12: 'h', hh12: 'hh', n: 'm', nn: 'mm', min: 'm', mins: 'mm', s: 's', ss: 'ss',
  ttttt: 'h:mm:ss tt', 'AM/PM': 'tt', AMPM: 'tt',
};
// Text in a .NET pattern: a letter, a quote, % and \ are escaped.
const netText = s => String(s).replace(/[A-Za-z%\\'"]/g, c => `\\${c}`);

// FORMAT(date, pattern): tokens from dateFormat.
export function formatDate(d, x, tokens) {
  return d.bind([`CAST(${x} AS DATETIME2(6))`], v => {
    const net = p => `FORMAT(${v}, ${d.str(p.length === 1 ? `%${p}` : p)}, 'en-US')`;
    const pieces = [];
    const sql = s => pieces.push({ s });
    for (const k of tokens) {
      if (k.t === 'lit') pieces.push({ f: netText(k.v) });
      else if (NET[k.t]) pieces.push({ f: NET[k.t] });
      else if (k.t === 'y') sql(`CAST(DATEPART(DAYOFYEAR, ${v}) AS VARCHAR(3))`);
      else if (k.t === 'w') sql(`CAST(${dow(v)} + 1 AS VARCHAR(1))`);
      else if (k.t === 'ww') sql(`CAST((DATEPART(DAYOFYEAR, ${v}) - 1 + ${dow(`DATEFROMPARTS(YEAR(${v}), 1, 1)`)}) / 7 + 1 AS VARCHAR(2))`);
      else if (k.t === 'q') sql(`CAST(DATEPART(QUARTER, ${v}) AS VARCHAR(1))`);
      else if (k.t === 'am/pm') sql(`LOWER(${net('tt')})`);
      else if (k.t === 'A/P') sql(`LEFT(${net('tt')}, 1)`);
      else if (k.t === 'a/p') sql(`LOWER(LEFT(${net('tt')}, 1))`);
      else if (k.t === 'c') sql(d.text(v, 'datetime'));
      else throw new Error(`FORMAT: date token ${k.t}`);
    }
    // Runs of .NET pieces in one FORMAT.
    const parts = [];
    for (const p of pieces) {
      if (p.f !== undefined && parts.length && parts.at(-1).f !== undefined) parts.at(-1).f += p.f;
      else parts.push({ ...p });
    }
    return `CASE WHEN ${v} IS NULL THEN '' ELSE ${cat(parts.map(p => (p.f !== undefined ? net(p.f) : p.s)))} END`;
  });
}
