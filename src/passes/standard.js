// Standard scalars: DAX's operators and functions, which hold DAX's rules (a blank compared as
// 0, a blank plus a blank is blank, DIVIDE's zero), as the standard operators any engine has:
// comparisons, + - * /, AND OR NOT, IN, IS NULL, COALESCE, NULLIF, CASE, CAST, and standard
// functions under standard names (power, round, upper, length, substring, extract_year,
// add_days, date_trunc, …). What has no standard writing yet stays DAX's (operators.mjs
// lists those that are left: text of a number, a date's serial number, FORMAT, PATH, …).
import * as P from '../plan.js';
import { mapKids, mapScalars } from './decorrelate.js';

export function standard(root) {
  for (const d of root.defs ?? []) d.rel = R(d.rel);
  return { ...R(root), defs: root.defs };
}

function R(r) {
  r = mapKids(r, R);
  if (r.k === 'select') return { ...r, pred: L(r.pred, true) };
  if (r.k === 'join' && r.on) return { ...r, on: L(r.on, true) };
  r = mapScalars(r, x => L(x, false));
  return r.k === 'aggregate' ? aggregates(r) : r;
}

// DAX's aggregates as standard ones, and what DAX makes of them above the grouping: a count of
// no rows is blank (NULLIF), DISTINCTCOUNT counts the blank too, HASONEVALUE, a single value.
function aggregates(r) {
  const aggs = [], out = [];
  const agg = (fn, arg, t = 'int', extra = {}) => { const col = P.newCol(fn, t); aggs.push({ col, fn, arg, extra }); return P.ref(col); };
  const zero = lit(0, 'int'), one = lit(1, 'int');
  const blanks = x => caseOf([[cond('isnull', [x]), one]], zero, 'int');
  const nonzero = v => pop('nullif', [v, zero], 'int');
  for (const a of r.aggs) {
    const x = a.arg, n = aggs.length;
    let v = null;
    switch (a.fn) {
      case 'count0': v = agg('count', x); break;
      case 'count': v = nonzero(agg('count', x)); break;
      case 'countrows': v = nonzero(agg('count_star', null)); break;
      case 'dcount0': if (x.k !== 'fn') v = agg('count_distinct', x); break;
      case 'dcountnb': if (x.k !== 'fn') v = nonzero(agg('count_distinct', x)); break;
      case 'dcount': if (x.k !== 'fn') v = pop('add', [agg('count_distinct', x), agg('max', blanks(x))], 'int'); break;
      case 'countblank': v = nonzero(agg('sum', blanks(x))); break;
      case 'hasone': if (x.k !== 'fn') v = coalesce(cond('eq', [pop('add', [agg('count_distinct', x), agg('max', blanks(x))], 'int'), one]), lit(false, 'bool')); break;
      case 'onlyone': v = caseOf([[cond('eq', [agg('count_star', null), one]), agg('min', x, a.col.t)]], lit(null, a.col.t), a.col.t); break;
      case 'single': v = caseOf([[cond('gt', [agg('count_star', null), one]), call('raise_error', [lit(MANY, 'string')], a.col.t)]], agg('min', x, a.col.t), a.col.t); break;
      case 'concat': aggs.push({ ...a, fn: 'string_agg' }); break;
    }
    if (v) out.push({ col: a.col, expr: v });
    else if (aggs.length === n) aggs.push(a);   // DAX's (a percentile, a count of several columns)
  }
  if (!out.length) return { ...r, aggs };
  const g = { ...r, aggs, cols: [...r.keys.map(k => k.col), ...aggs.map(a => a.col)] };
  const post = new Map(out.map(o => [o.col, o.expr]));
  return P.projectAs(g, [...r.keys.map(k => ({ col: k.col, expr: P.ref(k.col) })), ...r.aggs.map(a => ({ col: a.col, expr: post.get(a.col) ?? P.ref(a.col) }))]);
}
const MANY = 'A table of multiple values was supplied where a single value was expected.';

// --- the plan's standard operators -------------------------------------------------------
const lit = (v, t) => ({ k: 'lit', v, t, nn: v !== null });
const pop = (op, a, t, nn = false, extra = {}) => ({ k: 'pop', op, a, t, nn, ...extra });
const cond = (op, a) => pop(op, a, 'bool', true);
const call = (name, a, t, nn = false) => pop('call', a, t, nn, { name });
const cast = (x, to) => pop('cast', [x], to, x.nn, { to });
const coalesce = (...a) => pop('coalesce', a, a.find(x => x.t && x.t !== 'blank')?.t ?? a[0].t, a.some(x => x.nn));
const caseOf = (w, e, t) => ({ k: 'case', w, e, t, nn: false });
const isNum = t => t === 'int' || t === 'double' || t === 'decimal';
const isDate = t => t === 'datetime' || t === 'date';
// A blank's value where DAX compares it: the type's default.
const blankOf = t => (t === 'string' ? lit('', 'string') : t === 'bool' ? lit(false, 'bool') : isDate(t) ? lit('1899-12-30', 'datetime') : lit(0, 'int'));
const blankJs = t => (t === 'string' ? '' : t === 'bool' ? false : isDate(t) ? '1899-12-30' : 0);
const cmpJs = (o, a, b) => ({ eq: a === b, ne: a !== b, lt: a < b, le: a <= b, gt: a > b, ge: a >= b })[o];

// A scalar, lowered; `pred`: where it is a condition of a σ or a join (unknown keeps no row).
export function L(x, pred = false) {
  switch (x.k) {
    case 'op': return op(x, pred);
    case 'fn': return fn(x);
    case 'case': return { ...x, w: x.w.map(([c, v]) => [L(c, true), L(v)]), e: L(x.e) };
    case 'pop': return { ...x, a: x.a.map(a => L(a, pred && (x.op === 'and' || x.op === 'or'))) };
    case 'exists': return { ...x, rel: R(x.rel) };
  }
  return x;
}

// A whole number in arithmetic: 64 bits, as DAX computes.
const N = v => (v.t === 'int' && (v.k === 'lit' || v.k === 'ref') ? cast(v, 'int') : v);
// A value as a condition: blank is FALSE, a number is its being other than 0.
function bool(v, pred) {
  if (v.t === 'bool' || v.t === 'blank' || v.t === 'variant') return v.nn || pred ? v : coalesce(v, lit(false, 'bool'));
  if (isNum(v.t)) return cond('ne', [coalesce(v, lit(0, 'int')), lit(0, 'int')]);
  return null;
}

function op(x, pred) {
  const keep = () => ({ ...x, a: x.a.map(a => L(a)) });
  const [l, r] = x.a.map(a => L(a, pred && (x.op === 'and' || x.op === 'or')));
  switch (x.op) {
    case 'add': case 'sub': {
      const name = x.op;
      if (isDate(l.t) && isNum(r.t)) return r.t === 'int' ? call('add_days', [l, name === 'sub' ? pop('neg', [r], 'int') : r], l.t) : keep();
      if (name === 'sub' && l.t === 'date' && r.t === 'date') return call('date_diff_day', [r, l], 'int');
      if (isDate(l.t) || isDate(r.t)) return keep();
      if (l.nn && r.nn) return pop(name, [N(l), N(r)], x.t, true);
      if (l.nn) return pop(name, [N(l), coalesce(r, lit(0, 'int'))], x.t, true);
      if (r.nn) return pop(name, [coalesce(l, lit(0, 'int')), N(r)], x.t, true);
      // Blank only when both are.
      return caseOf([[cond('and', [cond('isnull', [l]), cond('isnull', [r])]), lit(null, x.t)]], pop(name, [coalesce(N(l), lit(0, 'int')), coalesce(N(r), lit(0, 'int'))], x.t), x.t);
    }
    case 'mul': return pop('mul', [N(l), N(r)], x.t, x.nn);
    // x / BLANK() is x / 0; BLANK() / x is blank.
    case 'div': return pop('div', [l, r.nn ? r : coalesce(r, lit(0, 'int'))], x.t);
    case 'pow': return call('power', [l, r], x.t);
    case 'neg': return pop('neg', [N(l)], x.t, x.nn);
    case 'eq': case 'ne': case 'lt': case 'le': case 'gt': case 'ge': return compare(x.op, l, r, pred);
    case 'eqs': return cond('key', [l, r]);
    case 'and': case 'or': {
      const a = bool(l, pred), b = bool(r, pred);
      return a && b ? cond(x.op, [a, b]) : keep();
    }
    case 'not': { const a = bool(l, false); return a ? cond('not', [a]) : keep(); }
    case 'bool': return bool(l, pred) ?? keep();
    case 'concat': {
      const text = v => (v.t === 'string' || v.t === 'blank' ? v : v.t === 'int' ? cast(v, 'string') : null);
      const a = text(l), b = text(r);
      if (!a || !b) return keep();
      const t = v => (v.nn ? v : coalesce(v, lit('', 'string')));
      return pop('concat', [t(a), t(b)], 'string', true);
    }
    case 'in': {
      // Compared with ==: a blank is only a blank.
      const v = l, vals = x.a.slice(1).map(a => L(a));
      const isNull = y => y.k === 'lit' && y.v === null;
      const sure = vals.filter(y => !isNull(y) && (y.k === 'lit' || y.nn)), maybe = vals.filter(y => !isNull(y) && !(y.k === 'lit' || y.nn));
      const parts = [];
      if (sure.length) { const s = cond('in', [v, ...sure]); parts.push(pred ? s : coalesce(s, lit(false, 'bool'))); }
      for (const y of maybe) parts.push(cond('key', [v, y]));
      if (vals.some(isNull)) parts.push(cond('isnull', [v]));
      return parts.length ? parts.reduce((a, b) => cond('or', [a, b])) : cond('false', []);
    }
  }
  return keep();
}

// DAX compares a blank as the other side's default (0, "", FALSE); a comparison is never blank.
function compare(o, l, r, pred) {
  const t = [l.t, r.t].find(y => y !== 'blank' && y !== 'variant') ?? 'int';
  if (l.nn && r.nn) return cond(o, [l, r]);
  const constant = (v, side) => (v.k === 'lit' && v.v !== null ? side : null);
  const side = constant(r, 'r') ?? constant(l, 'l');
  if (side) {
    const [k, v] = side === 'r' ? [r, l] : [l, r];
    const holds = cmpJs(o, ...(side === 'r' ? [blankJs(t), k.v] : [k.v, blankJs(t)]));
    const c = cond(o, [l, r]);
    if (holds) return cond('or', [c, cond('isnull', [v])]);
    return pred ? c : coalesce(c, lit(false, 'bool'));
  }
  const z = blankOf(t);
  const S = v => (v.nn ? v : v.k === 'lit' && v.v === null ? z : coalesce(v, z));
  return cond(o, [S(l), S(r)]);
}

const UNIT = s => String(s.v ?? '').toLowerCase();
function fn(x) {
  const a = x.a.map(v => L(v));
  const keep = () => ({ ...x, a });
  const str = i => a[i]?.t === 'string' || a[i]?.t === 'blank';
  const [p, q, s] = a;
  switch (x.name) {
    case 'isblank': return cond('isnull', [p]);
    // A fixed decimal: four places, within a 64-bit count of ten-thousandths.
    case 'currency': return caseOf([[cond('ge', [call('abs', [p], p.t), { k: 'lit', v: '922337203685477.5808', t: 'decimal', nn: true, digits: true }]),
      call('raise_error', [lit('DAX: the result of a conversion or arithmetic operation is too large or too small for a fixed decimal number', 'string')], 'decimal')]],
    call('round', [p, lit(4, 'int')], 'decimal'), 'decimal');
    case 'coalesce': return a.length > 1 && a.every(v => v.t === a[0].t || v.t === 'blank' || isNum(v.t) === isNum(a[0].t)) && x.t !== 'variant' ? coalesce(...a) : keep();
    case 'divide': return a.length === 2 ? pop('div', [p, pop('nullif', [q, lit(0, 'int')], q.t)], x.t)
      : caseOf([[cond('eq', [coalesce(q, lit(0, 'int')), lit(0, 'int')]), s]], pop('div', [p, q], x.t), x.t);
    case 'iseven': case 'isodd': {
      const n = cast(call('trunc', [p], 'double'), 'int');
      return cond(x.name === 'iseven' ? 'eq' : 'ne', [call('mod', [n, lit(2, 'int')], 'int'), lit(0, 'int')]);
    }
    case 'abs': case 'sign': case 'sqrt': case 'exp': case 'ln': case 'log10': case 'power': return call(x.name, a, x.t);
    case 'log': return pop('div', [call('ln', [p], 'double'), call('ln', [q], 'double')], 'double');
    // DAX's MOD: the sign of the divisor.
    case 'mod': return pop('sub', [p, pop('mul', [q, call('floor', [pop('div', [p, q], 'double')], 'double')], x.t)], x.t);
    case 'quotient': return cast(call('trunc', [pop('div', [p, q], 'double')], 'double'), 'int');
    case 'int': return cast(call('floor', [p], 'double'), 'int');
    case 'round': return call('round', [p, cast(q, 'int')], x.t);
    case 'value': return cast(p, 'double');
    case 'greatest': case 'least': return call(x.name, a, x.t);
    case 'upper': case 'lower': return str(0) ? call(x.name, a, 'string') : keep();
    case 'len': return str(0) ? call('length', [p], 'int') : keep();
    case 'left': case 'right': return str(0) ? call(x.name, [p, q ?? lit(1, 'int')], 'string') : keep();
    case 'mid': return str(0) ? call('substring', [p, q, s], 'string') : keep();
    case 'trim_ends': return str(0) ? call('trim', [p], 'string') : keep();
    case 'exact': return str(0) && str(1) ? cond('eq', [coalesce(p, lit('', 'string')), coalesce(q, lit('', 'string'))]) : keep();
    case 'containsstringexact': return str(0) && str(1) ? call('contains', [coalesce(p, lit('', 'string')), coalesce(q, lit('', 'string'))], 'bool', true) : keep();
    case 'containsstring': return str(0) && str(1) ? call('contains', [call('lower', [coalesce(p, lit('', 'string'))], 'string'), call('lower', [coalesce(q, lit('', 'string'))], 'string')], 'bool', true) : keep();
    case 'year': case 'month': case 'day': case 'hour': case 'minute': case 'second': case 'quarter':
      return isDate(p.t) ? call(`extract_${x.name}`, [p], 'int') : keep();
    case 'cast': {
      const to = q?.v;
      if (to === 'datetime' && p.t === 'string') return keep();   // text read as a date: DAX's formats
      return ['int', 'double', 'decimal', 'string', 'bool', 'datetime'].includes(to) && !(to === 'string' && !['string', 'int', 'blank'].includes(p.t)) ? cast(p, to) : keep();
    }
    case 'add_interval': {
      const u = UNIT(s);
      if (u === 'day') return call('add_days', [p, q], x.t);
      if (u === 'week') return call('add_days', [p, pop('mul', [lit(7, 'int'), q], 'int')], x.t);
      if (u === 'month' || u === 'quarter' || u === 'year') return call('add_months', [p, u === 'month' ? q : pop('mul', [lit(u === 'year' ? 12 : 3, 'int'), q], 'int')], x.t);
      return keep();
    }
    case 'start_of': return ['month', 'quarter', 'year', 'day'].includes(UNIT(q)) ? call(`date_trunc_${UNIT(q)}`, [p], 'date') : keep();
    case 'end_of': {
      const u = UNIT(q);
      if (u === 'day') return call('date_trunc_day', [p], 'date');
      if (u !== 'month' && u !== 'quarter' && u !== 'year') return keep();
      // The last day: the start of the next one, less a day.
      const next = call('add_months', [call(`date_trunc_${u}`, [p], 'date'), lit(u === 'year' ? 12 : u === 'quarter' ? 3 : 1, 'int')], 'date');
      return call('add_days', [next, lit(-1, 'int')], 'date');
    }
    case 'eomonth': return call('add_days', [call('add_months', [call('date_trunc_month', [p], 'date'), pop('add', [cast(q, 'int'), lit(1, 'int')], 'int')], 'date'), lit(-1, 'int')], 'date');
    case 'datediff': return UNIT(s) !== 'week' && ['day', 'month', 'quarter', 'year', 'hour', 'minute', 'second'].includes(UNIT(s)) ? call(`date_diff_${UNIT(s)}`, [p, q], 'int') : keep();
  }
  return keep();
}
