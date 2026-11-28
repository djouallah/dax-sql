// DAX's functions that standard SQL has no one function for, each defined once as standard
// functions (the plan's: strpos, substring, length, left, concat, CASE, CAST, extract_*, round,
// floor, log10, power, mod, …), so the plan holds only standard functions and every engine, and
// Substrait, takes them as they are:
//
//   generalNumber   a number with a fraction as DAX writes it: 15 significant digits (C's %.15g)
//   generalDate     a date as DAX writes it: M/D/YYYY, h:mm:ss AM/PM where not midnight
//   combineValues   COMBINEVALUES: the values as text, joined by the separator
//   replaceNth      SUBSTITUTE with an instance number: the n-th occurrence replaced
//   parseDatetime   text as a date and time: ISO, or en-US (3/5/2024, March 5, 2024)
//   codePoint       UNICODE of a printable ASCII character
//   formatNumber    FORMAT of a number by a pattern (format.js's: sections, digits, separators)
//   formatDate      FORMAT of a date by a pattern (format.js's tokens)
//
// A value read more than once is bound (bind: a column of a projection below the relation whose
// scalars read it), so a definition is as long as it reads. A number is never cast to text but
// a whole number (engines write a double each in its own way: 3.0, 3, 3E0): the 15 digits are a
// whole number, the point put where the exponent says.

const lit = (v, t) => ({ k: 'lit', v, t, nn: v !== null });
const pop = (op, a, t, nn = false, extra = {}) => ({ k: 'pop', op, a, t, nn, ...extra });
const cond = (op, a) => pop(op, a, 'bool', true);
const call = (name, a, t, nn = false) => pop('call', a, t, nn, { name });
const cast = (x, to) => pop('cast', [x], to, x.nn, { to });
const caseOf = (w, e, t) => ({ k: 'case', w, e, t, nn: false });
const S = v => lit(v, 'string'), I = v => lit(v, 'int'), D = v => lit(v, 'double');
const cat = (...xs) => xs.reduce((l, r) => pop('concat', [l, r], 'string', true));
const add = (a, b) => pop('add', [a, b], 'int'), sub = (a, b) => pop('sub', [a, b], 'int'), mul = (a, b) => pop('mul', [a, b], 'int');
const eq = (a, b) => cond('eq', [a, b]), lt = (a, b) => cond('lt', [a, b]), gt = (a, b) => cond('gt', [a, b]), ge = (a, b) => cond('ge', [a, b]);
const and = (...xs) => xs.reduce((l, r) => cond('and', [l, r])), or = (...xs) => xs.reduce((l, r) => cond('or', [l, r]));
const len = x => call('length', [x], 'int');
// Lengths and positions at least 0 and 1: an engine may compute a CASE's branch no row takes
// (Polars), where one is past the text.
const atLeast = (n, m) => call('greatest', [n, I(m)], 'int');
const left = (x, n) => call('left', [x, atLeast(n, 0)], 'string');
const mid = (x, from, n) => call('substring', [x, atLeast(from, 1), atLeast(n, 0)], 'string');
const from = (x, i) => call('substring_from', [x, atLeast(i, 1)], 'string');
const pos = (h, n) => call('strpos', [h, n], 'int');
const str = x => cast(x, 'string');   // a whole number as text
const part = (name, x) => call(`extract_${name}`, [x], 'int');
// A whole number 0..99 in two digits.
const two = n => caseOf([[lt(n, I(10)), cat(S('0'), str(n))]], str(n), 'string');
// A text of one or two digits in two.
const twoText = t => caseOf([[eq(len(t), I(1)), cat(S('0'), t)]], t, 'string');

export function definitions(bind) {
  // --- numbers: 15 significant digits ---
  function generalNumber(v) {
    const a = bind(call('abs', [cast(v, 'double')], 'double'), 'a');
    const e0 = bind(cast(call('floor', [call('log10', [caseOf([[eq(a, D(0)), D(1)]], a, 'double')], 'double')], 'double'), 'int'), 'e0');
    // |v|'s 15 digits as a whole number, and the exponent after rounding (999.99999999999999 is
    // 1000): 10^14 <= M < 10^15.
    const m0 = bind(cast(call('round', [pop('mul', [a, call('power', [D(10), sub(I(14), e0)], 'double')], 'double'), I(0)], 'double'), 'int'), 'm0');
    const carry = bind(ge(m0, I(1e15)), 'carry');
    const M = bind(caseOf([[carry, I(1e14)]], m0, 'int'), 'm');
    const ex = bind(add(e0, caseOf([[carry, I(1)]], I(0), 'int')), 'ex');
    const digits = bind(str(M), 'digits');
    // The digits without the zeros after the last one that is not (k of them).
    const zeros = caseOf(Array.from({ length: 14 }, (_, i) => [eq(call('mod', [M, I(10 ** (14 - i))], 'int'), I(0)), I(14 - i)]), I(0), 'int');
    const k = bind(sub(I(15), zeros), 'k');
    const s = bind(left(digits, k), 's');
    const Z = n => left(S('00000000000000000000'), n);
    // -4 <= ex < 15: the point where the exponent puts it.
    const whole = caseOf([[gt(k, add(ex, I(1))), left(s, add(ex, I(1)))]], cat(s, Z(sub(add(ex, I(1)), k))), 'string');
    const frac = caseOf([[gt(k, add(ex, I(1))), cat(S('.'), from(s, add(ex, I(2))))]], S(''), 'string');
    const plain = caseOf([[ge(ex, I(0)), cat(whole, frac)]], cat(S('0.'), Z(sub(I(-1), ex)), s), 'string');
    // Else d.ddddE+xx.
    const mant = cat(left(s, I(1)), caseOf([[gt(k, I(1)), cat(S('.'), from(s, I(2)))]], S(''), 'string'));
    const sci = cat(mant, S('E'), caseOf([[lt(ex, I(0)), S('-')]], S('+'), 'string'), two(call('abs', [ex], 'int')));
    const sign = caseOf([[lt(cast(v, 'double'), D(0)), S('-')]], S(''), 'string');
    return caseOf([
      [cond('isnull', [v]), lit(null, 'string')],
      [eq(a, D(0)), S('0')],
      [or(lt(ex, I(-4)), ge(ex, I(15))), cat(sign, sci)],
    ], cat(sign, plain), 'string');
  }

  // --- dates ---
  function generalDate(v0) {
    // As a date and time (T-SQL takes no hour of a DATE).
    const v = bind(cast(v0, 'datetime'), 'dt');
    const [y, mo, d, h, mi, se] = ['year', 'month', 'day', 'hour', 'minute', 'second'].map(n => bind(part(n, v), n));
    const date = cat(str(mo), S('/'), str(d), S('/'), str(y));
    const h12 = caseOf([[eq(h, I(0)), I(12)], [gt(h, I(12)), sub(h, I(12))]], h, 'int');
    const time = cat(str(h12), S(':'), two(mi), S(':'), two(se), caseOf([[lt(h, I(12)), S(' AM')]], S(' PM'), 'string'));
    return caseOf([
      [cond('isnull', [v]), lit(null, 'string')],
      [and(eq(h, I(0)), eq(mi, I(0)), eq(se, I(0))), date],
      [and(eq(y, I(1899)), eq(mo, I(12)), eq(d, I(30))), time],
    ], cat(date, S(' '), time), 'string');
  }

  // --- text ---
  // COMBINEVALUES(separator, values…): each value's text, a blank as "".
  const combineValues = (sep, texts) => cat(...texts.flatMap((t, i) => (i ? [sep, coalesce(t)] : [coalesce(t)])));
  function coalesce(t) { return pop('coalesce', [t, S('')], 'string', true); }

  // SUBSTITUTE(text, old, new, n): the n-th occurrence's position by each one's after the one
  // before (n a constant: that many; else up to 10, the n-th of them).
  function replaceNth(x0, old0, neu, n) {
    const x = bind(x0, 'x'), old = bind(old0, 'old'), lo = bind(len(old), 'lo');
    const k = n.k === 'lit' && Number.isInteger(n.v) ? n.v : null;
    const count = k ?? 10;
    const at = [];
    for (let i = 0; i < Math.max(count, 0); i++) {
      if (!i) { at.push(bind(pos(x, old), 'p')); continue; }
      const prev = at[i - 1];
      const q = bind(caseOf([[eq(prev, I(0)), I(0)]], pos(from(x, add(prev, lo)), old), 'int'), 'q');
      at.push(bind(caseOf([[eq(q, I(0)), I(0)]], add(sub(add(prev, lo), I(1)), q), 'int'), 'p'));
    }
    const p = k != null ? (k >= 1 ? at[k - 1] : null) : bind(caseOf(at.map((v, i) => [eq(n, I(i + 1)), v]), I(0), 'int'), 'p');
    if (!p) return lit(null, 'string');   // an instance below 1: DAX's error (a plan raises none)
    return caseOf([[or(eq(lo, I(0)), eq(p, I(0))), x]], cat(left(x, sub(p, I(1))), neu, from(x, add(p, lo))), 'string');
  }

  // Text as a date and time: M/D/YYYY, "Month D, YYYY" (or Mon), else as it is (ISO).
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  function parseDatetime(x0) {
    const t = bind(call('trim', [x0], 'string'), 't');
    // M/D/YYYY (a time after it left out).
    const s1 = bind(pos(t, S('/')), 's1');
    const s2 = bind(caseOf([[gt(s1, I(0)), pos(from(t, add(s1, I(1))), S('/'))]], I(0), 'int'), 's2');
    const rest = bind(from(t, add(add(s1, s2), I(1))), 'rest');
    const sp = bind(pos(rest, S(' ')), 'sp');
    const year = caseOf([[gt(sp, I(0)), left(rest, sub(sp, I(1)))]], rest, 'string');
    const slash = cat(year, S('-'), twoText(left(t, sub(s1, I(1)))), S('-'), twoText(mid(t, add(s1, I(1)), sub(s2, I(1)))));
    // Month D, YYYY.
    const w = bind(pos(t, S(' ')), 'w');
    const word = bind(call('lower', [left(t, sub(w, I(1)))], 'string'), 'word');
    const month = bind(caseOf(MONTHS.map((m, i) => [or(eq(word, S(m)), eq(word, S(m.slice(0, 3)))), S(String(i + 1).padStart(2, '0'))]), lit(null, 'string'), 'string'), 'mon');
    const after = bind(from(t, add(w, I(1))), 'after');
    const c = bind(pos(after, S(',')), 'c');
    const named = cat(call('trim', [from(after, add(c, I(1)))], 'string'), S('-'), month, S('-'), twoText(left(after, sub(c, I(1)))));
    const iso = caseOf([[and(gt(s1, I(0)), gt(s2, I(0))), slash], [and(gt(w, I(0)), gt(c, I(0)), cond('notnull', [month])), named]], t, 'string');
    return cast(iso, 'datetime');
  }

  // UNICODE: a printable ASCII character's code, by its place among them (none else: blank).
  const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
  function codePoint(x) {
    const p = bind(pos(S(ASCII), left(x, I(1))), 'cp');
    return caseOf([[eq(p, I(0)), lit(null, 'int')]], add(p, I(31)), 'int');
  }

  // --- FORMAT of a number ---
  // 10^j as a whole number of 64 bits (exact as a double to 10^18), and a division of two (each
  // cast: T-SQL types a constant past 32 bits a DECIMAL).
  const pow10 = j => cast(call('power', [D(10), j], 'double'), 'int');
  const idiv = (a, b) => call('idiv', [cast(a, 'int'), cast(b, 'int')], 'int');
  // m >= 0 to 15 significant digits: { M, ex } (m is M * 10^(ex - 14)), as generalNumber has them.
  function digits15(m0) {
    // |m|: a value bound is computed for every row, those of the other sections too.
    const a = bind(call('abs', [cast(m0, 'double')], 'double'), 'fa');
    const e0 = bind(cast(call('floor', [call('log10', [caseOf([[eq(a, D(0)), D(1)]], a, 'double')], 'double')], 'double'), 'int'), 'fe0');
    const m = bind(cast(call('round', [pop('mul', [a, call('power', [D(10), sub(I(14), e0)], 'double')], 'double'), I(0)], 'double'), 'int'), 'fm0');
    const carry = bind(ge(m, I(1e15)), 'fcarry');
    return { M: bind(caseOf([[carry, I(1e14)]], m, 'int'), 'fm'), ex: bind(add(e0, caseOf([[carry, I(1)]], I(0), 'int')), 'fex') };
  }
  // M * 10^k rounded half up to a whole number.
  const scaleBy = (M, k) => caseOf([
    // (k at most 3 and a divisor at least 1 in the branch no row takes: in 64 bits, no division by 0.)
    [ge(k, I(0)), mul(M, pow10(call('least', [k, I(3)], 'int')))],
    [ge(k, I(-18)), idiv(add(M, mul(I(5), pow10(sub(sub(I(0), k), I(1))))), call('greatest', [pow10(sub(I(0), k)), I(1)], 'int'))],
  ], I(0), 'int');
  // M * 10^k (rounded half up) as text: M's digits and k zeros where k >= 0 (past 64 bits: the
  // 15 digits, then zeros, as DAX writes a number of more), else the whole number.
  const ZEROS = S('0'.repeat(330));
  const scaledText = (M, k) => caseOf([[ge(k, I(0)), cat(str(M), left(ZEROS, k))]], str(scaleBy(M, k)), 'string');
  // A whole number r >= 0 (or its digits, text) as text with n decimals: { int, frac } ("1234", "50").
  function places(r, n) {
    const t = bind(r.t === 'string' ? r : str(r), 'ft'), l = bind(len(t), 'fl');
    if (!n) return { int: t, frac: S('') };
    return {
      int: caseOf([[gt(l, I(n)), left(t, sub(l, I(n)))]], S('0'), 'string'),
      frac: caseOf([[gt(l, I(n)), from(t, add(sub(l, I(n)), I(1)))]], cat(left(S('0'.repeat(n)), sub(I(n), l)), t), 'string'),
    };
  }
  const hasDigits = sec => sec.nInt + sec.nFrac + sec.nExp > 0 || sec.point;
  const isWhole = (sec, t) => t === 'int' && !sec.scale && !sec.sci;
  const scaled = (sec, a) => {
    const up = 100 ** sec.pct, down = 1000 ** sec.scale;
    if (up === 1 && down === 1) return a;
    let v = cast(a, 'double');
    if (up > 1) v = pop('mul', [v, D(up)], 'double');
    if (down > 1) v = pop('div', [v, D(down)], 'double');
    return v;
  };
  // a >= 0 in a section: { int, frac, e (the exponent), zero (whether it shows as 0) }.
  function rounded(sec, a, t) {
    const m = bind(scaled(sec, a), 'fs'), n = sec.nFrac;
    // A whole number: its digits, n zeros after the point.
    if (isWhole(sec, t)) return { int: str(m), frac: S('0'.repeat(n)), zero: eq(m, I(0)) };
    const { M, ex } = digits15(m);
    if (!sec.sci) {
      const k = bind(add(sub(ex, I(14)), I(n)), 'fk');
      const r = bind(scaledText(M, k), 'fr');
      return { ...places(r, n), zero: or(eq(M, I(0)), eq(r, S('0'))) };
    }
    // The exponent puts nInt digits before the point (one more where rounding carries: 9.996 is
    // 10.00): r the k + n digits.
    const k = Math.max(sec.nInt, 1);
    const e0 = bind(caseOf([[eq(m, D(0)), I(0)]], sub(ex, I(k - 1)), 'int'), 'fe');
    const r0 = bind(scaleBy(M, add(sub(sub(ex, I(14)), e0), I(n))), 'fr0');
    const over = bind(ge(r0, I(10 ** (k + n))), 'fover');
    const e = bind(add(e0, caseOf([[over, I(1)]], I(0), 'int')), 'fe1');
    const r = bind(caseOf([[over, scaleBy(M, add(sub(sub(ex, I(14)), e), I(n)))]], r0, 'int'), 'fr');
    return { ...places(r, n), e, zero: eq(m, D(0)) };
  }
  // A whole number's digits with a comma between each three from the right (30 at most).
  function thousands(d0) {
    const d = bind(d0, 'fd'), l = bind(len(d), 'fdl');
    const first = bind(add(call('mod', [sub(l, I(1)), I(3)], 'int'), I(1)), 'fd1');
    const groups = Array.from({ length: 9 }, (_, g) => caseOf([[gt(l, add(first, I(3 * g))), cat(S(','), mid(d, add(add(first, I(3 * g)), I(1)), I(3)))]], S(''), 'string'));
    return cat(left(d, first), ...groups);
  }
  // A section's text of a >= 0.
  function section(sec, a, t) {
    if (!hasDigits(sec)) return cat(S(''), ...sec.tokens.filter(x => x.t === 'lit').map(x => S(x.v)));
    const n = sec.nFrac, { int, frac, e } = rounded(sec, a, t);
    let d = bind(caseOf([[eq(int, S('0')), S('')]], int, 'string'), 'fi');   // "#.##" shows 0.5 as .5
    if (sec.nZeroInt) d = bind(cat(left(S('0'.repeat(sec.nZeroInt)), sub(I(sec.nZeroInt), len(d))), d), 'fi0');
    if (sec.thousands && !sec.interleaved) d = bind(thousands(d), 'fi1');
    let fr = frac;
    // The fraction's optional digits (#): its zeros at the end, as many as there are of them, gone.
    if (n > sec.nZeroFrac) {
      const f0 = bind(frac, 'ff'), w = [];
      for (let j = n - sec.nZeroFrac; j >= 1; j--) w.push([eq(call('right', [f0, I(j)], 'string'), S('0'.repeat(j))), left(f0, I(n - j))]);
      fr = caseOf(w, f0, 'string');
    }
    const parts = [];
    let intDone = false, fracDone = false, expDone = false, i = 0;
    const int0 = () => { if (!intDone) parts.push(d); intDone = true; };
    for (const x of sec.tokens) {
      if (x.t === 'lit') parts.push(S(x.v));
      else if (x.t === 'int' && sec.interleaved) {
        // Digits fill the placeholders from the right; the first takes the rest.
        const j = sec.nInt - 1 - i++, l = len(d);
        parts.push(j === sec.nInt - 1 ? left(d, sub(l, I(j))) : caseOf([[gt(l, I(j)), mid(d, sub(l, I(j)), I(1))]], S(''), 'string'));
        intDone = true;
      } else if (x.t === 'int') int0();
      else if (x.t === 'point') { int0(); parts.push(S('.')); }
      else if (x.t === 'frac') { if (!fracDone) parts.push(fr); fracDone = true; }
      else if (x.t === 'exp') {
        int0();
        parts.push(S(sec.sci.upper ? 'E' : 'e'), caseOf([[lt(e, I(0)), S('-')]], S(sec.sci.plus ? '+' : ''), 'string'));
      } else if (x.t === 'expd' && !expDone) {
        const ae = bind(str(call('abs', [e], 'int')), 'fae');
        parts.push(cat(left(S('0'.repeat(Math.max(sec.nExp, 1))), sub(I(sec.nExp), len(ae))), ae));
        expDone = true;
      }
    }
    return cat(S(''), ...parts);
  }
  // FORMAT(number, pattern): spec from format.js's numberFormat; t the value's type.
  function formatNumber(x, spec, t) {
    if (spec.general) return pop('coalesce', [t === 'int' ? str(x) : t === 'bool' ? caseOf([[x, S('True')]], S('False'), 'string') : generalNumber(x), S('')], 'string', true);
    if (t === 'bool') { x = caseOf([[x, I(1)]], I(0), 'int'); t = 'int'; }
    const vt = t === 'int' ? 'int' : 'double';
    const v = bind(cast(x, vt), 'fv');
    if (spec.bool) return caseOf([[cond('isnull', [v]), S('')], [cond('ne', [v, I(0)]), S(spec.bool[0])]], S(spec.bool[1]), 'string');
    const [pos, neg, zero] = spec.sections;
    const zeroOf = vt === 'int' ? I(0) : D(0);
    // Zero takes the third section (the first when there is none); a negative value the second,
    // or the first with a minus sign, and the zero one when it rounds to zero.
    const z = section(zero ?? pos, zeroOf, vt);
    const negSec = neg ?? pos, minus = bind(pop('neg', [v], vt), 'fneg');
    const negZero = !hasDigits(negSec) ? lit(false, 'bool') : negSec.sci ? eq(minus, zeroOf) : rounded(negSec, minus, vt).zero;
    const negText = caseOf([[negZero, z]], neg ? section(negSec, minus, vt) : cat(S('-'), section(negSec, minus, vt)), 'string');
    return caseOf([[cond('isnull', [v]), S('')], [gt(v, zeroOf), section(pos, v, vt)], [eq(v, zeroOf), z]], negText, 'string');
  }

  // --- FORMAT of a date ---
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTH_NAMES = MONTHS.map(m => m[0].toUpperCase() + m.slice(1));
  function formatDate(x, tokens) {
    const v = bind(cast(x, 'datetime'), 'fdt');
    const memo = new Map();
    const P_ = name => { if (!memo.has(name)) memo.set(name, bind(name === 'dow' ? call('extract_dow', [v], 'int') : part(name, v), `f${name}`)); return memo.get(name); };
    const day = (names, short) => caseOf(names.map((nm, i) => [eq(P_('dow'), I(i)), S(short ? nm.slice(0, 3) : nm)]), lit(null, 'string'), 'string');
    const month = short => caseOf(MONTH_NAMES.map((nm, i) => [eq(P_('month'), I(i + 1)), S(short ? nm.slice(0, 3) : nm)]), lit(null, 'string'), 'string');
    const h12 = () => caseOf([[eq(P_('hour'), I(0)), I(12)], [gt(P_('hour'), I(12)), sub(P_('hour'), I(12))]], P_('hour'), 'int');
    const ampm = () => caseOf([[lt(P_('hour'), I(12)), S('AM')]], S('PM'), 'string');
    const year4 = () => { const y = bind(str(P_('year')), 'fy4'); return cat(left(S('000'), sub(I(4), len(y))), y); };
    const doy = () => add(call('date_diff_day', [call('date_trunc_year', [v], 'date'), v], 'int'), I(1));
    const piece = t => {
      switch (t) {
        case 'd': return str(P_('day'));
        case 'dd': return two(P_('day'));
        case 'ddd': return day(DAYS, true);
        case 'dddd': return day(DAYS, false);
        case 'ddddd': return cat(str(P_('month')), S('/'), str(P_('day')), S('/'), str(P_('year')));
        case 'dddddd': return cat(day(DAYS, false), S(', '), month(false), S(' '), str(P_('day')), S(', '), year4());
        case 'm': return str(P_('month'));
        case 'mm': return two(P_('month'));
        case 'mmm': return month(true);
        case 'mmmm': return month(false);
        case 'y': return str(doy());
        case 'yy': return two(call('mod', [P_('year'), I(100)], 'int'));
        case 'yyyy': return year4();
        case 'h': return str(P_('hour'));
        case 'hh': return two(P_('hour'));
        case 'h12': return str(h12());
        case 'hh12': return two(h12());
        case 'n': case 'min': return str(P_('minute'));
        case 'nn': case 'mins': return two(P_('minute'));
        case 's': return str(P_('second'));
        case 'ss': return two(P_('second'));
        case 'ttttt': return cat(str(h12()), S(':'), two(P_('minute')), S(':'), two(P_('second')), S(' '), ampm());
        case 'AM/PM': case 'AMPM': return ampm();
        case 'am/pm': return call('lower', [ampm()], 'string');
        case 'A/P': return left(ampm(), I(1));
        case 'a/p': return call('lower', [left(ampm(), I(1))], 'string');
        case 'w': return str(add(P_('dow'), I(1)));
        case 'ww': return str(add(idiv(add(sub(doy(), I(1)), call('extract_dow', [call('date_trunc_year', [v], 'date')], 'int')), I(7)), I(1)));
        case 'q': return str(P_('quarter'));
        case 'c': return generalDate(v);
      }
      throw new Error(`FORMAT: date token ${t}`);
    };
    return caseOf([[cond('isnull', [v]), S('')]], cat(S(''), ...tokens.map(x => (x.t === 'lit' ? S(x.v) : piece(x.t)))), 'string');
  }

  return { generalNumber, generalDate, combineValues, replaceNth, parseDatetime, codePoint, formatNumber, formatDate };
}

// The columns a scalar reads.
export function refsIn(x, out = new Set()) {
  if (!x || typeof x !== 'object') return out;
  if (x.k === 'ref') out.add(x.col);
  if (x.k === 'case') { x.w.forEach(([c, v]) => { refsIn(c, out); refsIn(v, out); }); refsIn(x.e, out); }
  if (Array.isArray(x.a)) x.a.forEach(y => refsIn(y, out));
  return out;
}
