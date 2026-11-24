// Standard scalars: DAX's operators and functions, which hold DAX's rules (a blank compared as
// 0, a blank plus a blank is blank, DIVIDE's zero), as the standard operators any engine has:
// comparisons, + - * /, AND OR NOT, IN, IS NULL, COALESCE, NULLIF, CASE, CAST, and standard
// functions under standard names (power, round, upper, length, substring, extract_year,
// add_days, date_trunc, …). What standard SQL has no one function for is defined as standard
// functions (text.js: a number or a date as text, COMBINEVALUES, SUBSTITUTE's instance, text as
// a date, UNICODE); FORMAT is a named function of the plan's that each dialect writes
// (format_number, format_date).
import * as P from '../plan.js';
import { mapKids, mapScalars } from './decorrelate.js';
import { clone } from './clone.js';
import { definitions, refsIn } from './text.js';

// A value a definition reads more than once (text.js): bound, a column of a projection below the
// relation whose scalars read it (one projection for each depth of them); where no relation is
// in hand (a join's condition, a row of constants), written where it is read.
let lets = null;
function bind(expr, name = 'v') {
  if (!lets || expr.k === 'ref' || expr.k === 'lit') return expr;
  const reads = refsIn(expr);
  const layer = 1 + Math.max(0, ...lets.filter(l => reads.has(l.col)).map(l => l.layer));
  const col = P.newCol(name, expr.t ?? 'string', { nn: !!expr.nn });
  lets.push({ col, expr, layer });
  return P.ref(col);
}
const DEF = definitions(bind);
// The relations whose scalars are of a row of their input.
const SCOPED = new Set(['select', 'project', 'aggregate', 'window', 'output']);
const same = cols => cols.map(c => ({ col: c, expr: P.ref(c) }));
// r's input with the bound values as its columns, each depth a projection.
function hoist(r, out, bound) {
  let src = out.src;
  const depth = Math.max(...bound.map(l => l.layer));
  for (let k = 1; k <= depth; k++) src = P.projectAs(src, [...same(src.cols), ...bound.filter(l => l.layer === k).map(l => ({ col: l.col, expr: l.expr }))]);
  // A filter's and a window's own columns are their input's: the bound ones left out above.
  if (out.k === 'select') return P.projectAs({ ...out, src, cols: src.cols }, same(r.cols));
  if (out.k === 'window') return P.projectAs({ ...out, src, cols: [...src.cols, ...out.fns.map(f => f.col)] }, same(r.cols));
  return { ...out, src };
}

export function standard(root) {
  for (const d of root.defs ?? []) d.rel = R(d.rel);
  return { ...R(root), defs: root.defs };
}

function R(r) {
  r = mapKids(r, R);
  const outer = lets;
  lets = SCOPED.has(r.k) ? [] : null;
  let out;
  try {
    if (r.k === 'select') out = { ...r, pred: L(r.pred, true) };
    else if (r.k === 'join' && r.on) out = { ...r, on: L(r.on, true) };
    else out = mapScalars(r, x => L(x, false));
    if (lets?.length) out = hoist(r, out, lets);
  } finally { lets = outer; }
  return out.k === 'aggregate' ? aggregates(out) : out;
}

// DAX's aggregates as standard ones, and what DAX makes of them above the grouping: a count of
// no rows is blank (NULLIF), DISTINCTCOUNT counts the blank too, HASONEVALUE, a single value.
// A distinct count of several columns (COUNTROWS(DISTINCT(…)), DISTINCTCOUNT of a row): the
// distinct rows of those columns (δ), counted by the grouping's keys, joined back to its groups.
// A percentile: the values numbered in order by the grouping's keys (a column's blanks left out,
// an expression's first), the two around the rank k(n - 1) + 1 (INC) or k(n + 1) (EXC), and
// the value between them as the rank is; a rank outside 1..n an error (DAX's), no values blank.
const ROWS = new Set(['dcount', 'dcount0', 'dcountnb', 'hasone']);
const PCT = new Set(['pct_inc', 'pct_exc', 'pctx_inc', 'pctx_exc']);
function percentile(r, as) {
  const { rel: src, map } = clone(r.src);
  const re = x => subst(x, map);
  const a0 = as[0], x = re(a0.arg);
  const rows = a0.fn.startsWith('pct_') ? P.select(src, cond('notnull', [x])) : src;
  const base = P.project(rows, [...r.keys.map(c => ({ name: c.col.name, expr: re(c.expr) })), { name: 'x', expr: x },
    ...as.map((a, j) => ({ name: `k${j}`, expr: coalesce(re(a.extra.k), lit(0, 'int')) }))]);
  const keys = base.cols.slice(0, r.keys.length), [vx, ...vks] = base.cols.slice(r.keys.length).map(c => P.ref(c));
  const w = P.window(base, keys.map(c => P.ref(c)), [{ name: 'i', fn: 'row_number', order: [{ expr: vx, mode: 'plain' }] }, { name: 'n', fn: 'count', order: [] }]);
  const [i, n] = w.fns.map(f => P.ref(f.col));
  const outKeys = keys.map(c => ({ col: P.newCol(c.name, c.t), expr: P.ref(c) }));
  const nn = P.newCol('n', 'int');
  const aggs = [{ col: nn, fn: 'max', arg: n, extra: {} }], values = [];
  as.forEach((a, j) => {
    const vk = vks[j];
    const rank = a.fn.endsWith('_inc') ? pop('add', [pop('mul', [vk, pop('sub', [n, lit(1, 'int')], 'int')], 'double'), lit(1, 'int')], 'double') : pop('mul', [vk, pop('add', [n, lit(1, 'int')], 'int')], 'double');
    const at = d => caseOf([[cond('eq', [i, pop('add', [call('floor', [rank], 'double'), lit(d, 'int')], 'double')]), vx]], lit(null, x.t), x.t);
    const [rr, lo, hi] = ['rank', 'lo', 'hi'].map(nm => P.newCol(nm, 'double'));
    aggs.push({ col: rr, fn: 'max', arg: rank, extra: {} }, { col: lo, fn: 'max', arg: at(0), extra: {} }, { col: hi, fn: 'max', arg: at(1), extra: {} });
    const R = P.ref(rr), low = coalesce(P.ref(lo), lit(0, 'int'));
    // A rank outside 1..n: DAX's error.
    const range = a.fn.endsWith('_inc') ? 'PERCENTILE.INC: k must lie in 0..1' : 'PERCENTILE.EXC: k must lie in 1/(n + 1)..n/(n + 1)';
    values.push(caseOf([
      [cond('isnull', [P.ref(nn)]), lit(null, a.col.t)],
      [cond('or', [cond('lt', [R, lit(1, 'int')]), cond('gt', [R, P.ref(nn)])]), error(range, a.col.t)],
      [cond('eq', [R, call('floor', [R], 'double')]), P.ref(lo)],
    ], pop('add', [low, pop('mul', [pop('sub', [R, call('floor', [R], 'double')], 'double'), pop('sub', [P.ref(hi), low], 'double')], 'double')], 'double'), a.col.t));
  });
  return { rel: P.aggregate(w, outKeys, aggs), keys: outKeys, values };
}
// Percentiles of the same values (their argument the same, blanks kept or not alike): one window,
// one grouping, whatever their k.
const sameValues = a => `${a.fn.startsWith('pct_')}|${JSON.stringify(a.arg, (k, v) => (k === 'col' && v && typeof v === 'object' && 'id' in v ? v.id : k === 'lineage' || k === 'table' ? undefined : v))}`;

function aggregates(r) {
  const tuples = r.aggs.filter(a => (ROWS.has(a.fn) && a.arg?.k === 'fn' && a.arg.name === 'row') || PCT.has(a.fn));
  if (!tuples.length) return plainAggregates(r);
  const rest = plainAggregates({ ...r, aggs: r.aggs.filter(a => !tuples.includes(a)), cols: [...r.keys.map(k => k.col), ...r.aggs.filter(a => !tuples.includes(a)).map(a => a.col)] });
  let rel = !r.keys.length && rest.k === 'aggregate' && !rest.aggs.length ? P.oneRow() : rest;
  const vals = new Map();
  const pcts = new Map();
  for (const a of tuples.filter(a => PCT.has(a.fn))) {
    const k = sameValues(a);
    if (!pcts.has(k)) pcts.set(k, []);
    pcts.get(k).push(a);
  }
  for (const as of pcts.values()) {
    const p = percentile(r, as);
    rel = p.keys.length ? P.join('left', rel, p.rel, P.and(r.keys.map((k, i) => P.key(P.ref(k.col), P.ref(p.keys[i].col))))) : P.join('cross', rel, p.rel);
    as.forEach((a, j) => vals.set(a.col, p.values[j]));
  }
  for (const a of tuples) {
    if (PCT.has(a.fn)) continue;
    const { rel: src, map } = clone(r.src);
    const re = x => subst(x, map);
    const items = [...r.keys.map(k => ({ name: k.col.name, expr: re(k.expr) })), ...a.arg.a.map((v, i) => ({ name: `c${i}`, expr: re(v) }))];
    const rows = P.distinct(P.project(src, items));
    const keys = r.keys.map((k, i) => ({ col: P.newCol(k.col.name, k.col.t), expr: P.ref(rows.cols[i]) }));
    const n = P.newCol('rows', 'int');
    const counted = P.aggregate(rows, keys, [{ col: n, fn: 'count_star', arg: null, extra: {} }]);
    rel = keys.length ? P.join('left', rel, counted, P.and(r.keys.map((k, i) => P.key(P.ref(k.col), P.ref(keys[i].col))))) : P.join('cross', rel, counted);
    // A row is never blank: the count of distinct rows; over no rows, blank (HASONEVALUE: FALSE).
    const c = P.ref(n), zero = lit(0, 'int');
    vals.set(a.col, a.fn === 'hasone' ? coalesce(cond('eq', [c, lit(1, 'int')]), lit(false, 'bool')) : a.fn === 'dcount0' ? coalesce(c, zero) : pop('nullif', [c, zero], 'int'));
  }
  return P.projectAs(rel, [...r.keys.map(k => ({ col: k.col, expr: P.ref(k.col) })), ...r.aggs.map(a => ({ col: a.col, expr: vals.get(a.col) ?? P.ref(a.col) }))]);
}
// A scalar reading the columns `map` names instead.
const subst = (x, map) => {
  if (!x || typeof x !== 'object') return x;
  if (x.k === 'ref') return map.has(x.col) ? P.ref(map.get(x.col)) : x;
  if (x.k === 'op' || x.k === 'fn' || x.k === 'pop') return { ...x, a: x.a.map(y => subst(y, map)) };
  if (x.k === 'case') return { ...x, w: x.w.map(([c, v]) => [subst(c, map), subst(v, map)]), e: subst(x.e, map) };
  return x;
};

function plainAggregates(r) {
  const aggs = [], out = [];
  const agg = (fn, arg, t = 'int', extra = {}) => { const col = P.newCol(fn, t); aggs.push({ col, fn, arg, extra }); return P.ref(col); };
  const zero = lit(0, 'int'), one = lit(1, 'int');
  const blanks = x => caseOf([[cond('isnull', [x]), one]], zero, 'int');
  const nonzero = v => pop('nullif', [v, zero], 'int');
  for (const a of r.aggs) {
    const x = a.arg, n = aggs.length;
    let v = null;
    switch (a.fn) {
      case 'count0': v = agg('count_values', x); break;
      case 'count': v = nonzero(agg('count_values', x)); break;
      case 'countrows': v = nonzero(agg('count_star', null)); break;
      case 'dcount0': if (x.k !== 'fn') v = agg('count_distinct', x); break;
      case 'dcountnb': if (x.k !== 'fn') v = nonzero(agg('count_distinct', x)); break;
      case 'dcount': if (x.k !== 'fn') v = pop('add', [agg('count_distinct', x), agg('max', blanks(x))], 'int'); break;
      case 'countblank': v = nonzero(agg('sum', blanks(x))); break;
      case 'hasone': if (x.k !== 'fn') v = coalesce(cond('eq', [pop('add', [agg('count_distinct', x), agg('max', blanks(x))], 'int'), one]), lit(false, 'bool')); break;
      case 'onlyone': v = caseOf([[cond('eq', [agg('count_star', null), one]), agg('min', x, a.col.t)]], lit(null, a.col.t), a.col.t); break;
      // Several values where one is expected: DAX's error.
      case 'single': v = caseOf([[cond('gt', [agg('count_star', null), one]), error(MANY, a.col.t)]], agg('min', x, a.col.t), a.col.t); break;
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

// --- the plan's standard operators -------------------------------------------------------
const lit = (v, t) => ({ k: 'lit', v, t, nn: v !== null });
const pop = (op, a, t, nn = false, extra = {}) => ({ k: 'pop', op, a, t, nn, ...extra });
const cond = (op, a) => pop(op, a, 'bool', true);
const call = (name, a, t, nn = false) => pop('call', a, t, nn, { name });
// DAX's runtime error: the query fails with the message.
const error = (msg, t) => call('error', [lit(msg, 'string')], t);
const MANY = 'A table of multiple values was supplied where a single value was expected.';
const FIXED = 'DAX: the result of a conversion or arithmetic operation is too large or too small for a fixed decimal number';
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
    // Values of different kinds together (a number or a text): as text, as DAX writes them.
    case 'case': {
      const V = v => (x.t === 'variant' ? asText(L(v)) : L(v));
      return { ...x, w: x.w.map(([c, v]) => [L(c, true), V(v)]), e: V(x.e) };
    }
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
      if (isDate(l.t) && isNum(r.t)) return r.t === 'int' ? call('add_days', [l, name === 'sub' ? pop('neg', [r], 'int') : r], l.t) : fromSerial(pop(name, [serial(l), r], 'double'));
      if (name === 'add' && isNum(l.t) && isDate(r.t)) return l.t === 'int' ? call('add_days', [r, l], r.t) : fromSerial(pop('add', [l, serial(r)], 'double'));
      if (name === 'sub' && l.t === 'date' && r.t === 'date') return call('date_diff_day', [r, l], 'int');
      // A date minus a date: the days between them, a fraction of one with a time; a date and
      // time plus another: the second's time since day zero added to the first.
      if (name === 'sub' && isDate(l.t) && isDate(r.t)) return pop('sub', [serial(l), serial(r)], 'double');
      if (isDate(l.t) && isDate(r.t)) return caseOf([[cond('and', [cond('isnull', [l]), cond('isnull', [r])]), lit(null, 'datetime')]], fromSerial(pop('add', [coalesce(serial(l), int(0)), coalesce(serial(r), int(0))], 'double')), 'datetime');
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
      const a = asText(l), b = asText(r);
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
const int = v => lit(v, 'int');
// A value as text: text itself, a whole number its digits, a logical TRUE or FALSE; a number
// with a fraction or a date to_text (as DAX writes it: 15 digits, a date en-US), which each
// dialect writes.
function asText(v) {
  if (v.t === 'string' || v.t === 'blank') return v;
  if (v.t === 'int') return cast(v, 'string');
  if (v.t === 'bool') return caseOf([[cond('eq', [v, lit(true, 'bool')]), lit('TRUE', 'string')], [cond('eq', [v, lit(false, 'bool')]), lit('FALSE', 'string')]], lit(null, 'string'), 'string');
  return isDate(v.t) ? DEF.generalDate(v) : DEF.generalNumber(v);
}
// A value read to 15 significant digits, as Power BI does before it cuts one (0.29 * 100 is
// 28.999999999999996 in binary; ROUNDDOWN(0.29, 2) is 0.29).
const g15 = v => caseOf([[cond('eq', [v, int(0)]), lit(0, 'double')]],
  call('round', [v, cast(pop('sub', [int(14), call('floor', [call('log10', [call('abs', [v], 'double')], 'double')], 'double')], 'double'), 'int')], 'double'), 'double');
// A value read to 15 digits, rounded to a whole number half away from zero.
const halfAway = v => pop('mul', [call('sign', [v], 'double'), call('floor', [pop('add', [g15(call('abs', [v], 'double')), lit(0.5, 'double')], 'double')], 'double')], 'double');
// A date and time as days since day zero (1899-12-30), with the fraction; and back.
const Z0 = lit('1899-12-30 00:00:00', 'datetime');
const MICRO = lit(86400000000, 'int');
const serial = v => pop('div', [call('date_diff_microsecond', [Z0, v], 'int'), MICRO], 'double');
const fromSerial = n => call('add_microseconds', [Z0, cast(call('round', [pop('mul', [n, MICRO], 'double'), int(0)], 'double'), 'int')], 'datetime');
const dow = v => call('extract_dow', [v], 'int');   // Sunday 0 .. Saturday 6
const tcat = (...xs) => xs.reduce((l, r) => pop('concat', [l, r], 'string', true));

function fn(x) {
  const a = x.a.map(v => L(v));
  const keep = () => ({ ...x, a });
  const T = i => asText(a[i]);
  const [p, q, s] = a;
  switch (x.name) {
    case 'isblank': return cond('isnull', [p]);
    // A fixed decimal: four places; past its range (922337203685477.5808, as 922337203685477 and
    // 0.5808: each a double exactly) DAX's error.
    case 'currency': return caseOf([[cond('ge', [pop('sub', [call('abs', [p], p.t), lit(922337203685477, 'int')], p.t), lit(0.5808, 'double')]), error(FIXED, 'decimal')]],
      call('round', [p, lit(4, 'int')], 'decimal'), 'decimal');
    // Values of different kinds together (a number or a text): as text, as DAX writes them.
    case 'coalesce': return x.t === 'variant' ? coalesce(...a.map(asText)) : coalesce(...a);
    case 'divide': return a.length === 2 ? pop('div', [p, pop('nullif', [q, lit(0, 'int')], q.t)], x.t)
      : caseOf([[cond('eq', [coalesce(q, lit(0, 'int')), lit(0, 'int')]), s]], pop('div', [p, q], x.t), x.t);
    // A fixed decimal over a whole number: the exact quotient of ten-thousandths, rounded half
    // away from zero, in whole numbers (|n| div |d|, and one more when twice the remainder is at
    // least |d|). Over 0 (or, for DIVIDE, a blank): as / and DIVIDE do with any number.
    case 'cydiv': case 'cydivide': {
      const n = cast(call('round', [pop('mul', [p, lit(10000, 'int')], 'double'), lit(0, 'int')], 'double'), 'int'), d = cast(q, 'int');
      const an = call('abs', [n], 'int'), ad = call('abs', [d], 'int');
      const up = caseOf([[cond('ge', [pop('mul', [lit(2, 'int'), call('mod', [an, ad], 'int')], 'int'), ad]), lit(1, 'int')]], lit(0, 'int'), 'int');
      const signed = pop('mul', [pop('mul', [call('sign', [n], 'int'), call('sign', [d], 'int')], 'int'), pop('add', [call('idiv', [an, ad], 'int'), up], 'int')], 'int');
      const zero = x.name === 'cydiv' ? pop('div', [cast(call('sign', [n], 'int'), 'double'), lit(0, 'int')], 'double') : (s ?? lit(null, 'double'));
      return caseOf([[cond('eq', [coalesce(d, lit(0, 'int')), lit(0, 'int')]), zero]], pop('div', [signed, lit(10000, 'int')], 'double'), 'double');
    }
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
    // Half away from zero, of the value read to 15 digits (ROUND(1.005, 2) is 1.01: 1.005 is
    // 1.00499… in binary, which an engine's round takes down).
    case 'round': {
      const k = call('power', [int(10), q], 'double');
      const r = pop('div', [halfAway(pop('mul', [p, k], 'double')), k], 'double');
      return x.t === 'double' ? r : cast(r, x.t);
    }
    case 'value': return cast(p, 'double');
    case 'greatest': case 'least': return call(x.name, x.t === 'variant' ? a.map(asText) : a, x.t);
    case 'upper': case 'lower': return call(x.name, [T(0)], 'string');
    case 'len': return call('length', [T(0)], 'int');
    case 'left': case 'right': return call(x.name, [T(0), q ?? int(1)], 'string');
    case 'mid': return call('substring', [T(0), q, s], 'string');
    case 'trim_ends': return call('trim', [T(0)], 'string');
    // DAX's TRIM: the spaces at the ends gone, and each run of them inside one space.
    case 'trim': return call('regexp_replace', [call('trim', [T(0)], 'string'), lit(' {2,}', 'string'), lit(' ', 'string')], 'string');
    case 'exact': return cond('eq', [coalesce(T(0), lit('', 'string')), coalesce(T(1), lit('', 'string'))]);
    case 'containsstringexact': return call('contains', [coalesce(T(0), lit('', 'string')), coalesce(T(1), lit('', 'string'))], 'bool', true);
    case 'containsstring': return call('contains', [call('lower', [coalesce(T(0), lit('', 'string'))], 'string'), call('lower', [coalesce(T(1), lit('', 'string'))], 'string')], 'bool', true);
    case 'unicode': return DEF.codePoint(T(0));
    // FIND(text, within, start, notfound), and SEARCH without regard to case.
    case 'find': case 'search': {
      const low = v => (x.name === 'search' ? call('lower', [v], 'string') : v);
      const within = call('substring_from', [coalesce(T(1), lit('', 'string')), s], 'string');
      const pos = call('strpos', [low(within), low(coalesce(T(0), lit('', 'string')))], 'int');
      return caseOf([[cond('eq', [pos, int(0)]), a[3]]], pop('add', [pos, pop('sub', [s, int(1)], 'int')], 'int'), 'int');
    }
    case 'substitute': return a.length === 3 ? call('replace', [T(0), T(1), T(2)], 'string') : DEF.replaceNth(T(0), T(1), T(2), a[3]);
    // A path's items ("|" between them): "" holds none, a blank path's length is blank, a
    // position past either end is blank.
    case 'pathlength': return caseOf([[cond('eq', [T(0), lit('', 'string')]), int(0)]], pop('add', [pop('sub', [call('length', [T(0)], 'int'), call('length', [call('replace', [T(0), lit('|', 'string'), lit('', 'string')], 'string')], 'int')], 'int'), int(1)], 'int'), 'int');
    case 'pathitem': case 'pathitemreverse': {
      const len = fn({ ...x, name: 'pathlength', a: [x.a[0]] });
      const at = x.name === 'pathitem' ? cast(q, 'int') : pop('add', [pop('sub', [len, cast(q, 'int')], 'int'), int(1)], 'int');
      // (Its position within the path: a part's at 0 or below is no part on some engines, an
      // error on others.)
      const within = x.name === 'pathitem' ? cond('ge', [q, int(1)]) : cond('and', [cond('ge', [q, int(1)]), cond('ge', [at, int(1)])]);
      return caseOf([[within, pop('nullif', [call('split_part', [T(0), lit('|', 'string'), at], 'string'), lit('', 'string')], 'string')]], lit(null, 'string'), 'string');
    }
    case 'pathcontains': return coalesce(cond('gt', [call('strpos', [tcat(lit('|', 'string'), pop('nullif', [T(0), lit('', 'string')], 'string'), lit('|', 'string')), tcat(lit('|', 'string'), T(1), lit('|', 'string'))], 'int'), int(0)]), lit(false, 'bool'));
    case 'weekday': {
      const d = dow(p), monday = call('mod', [pop('add', [d, int(6)], 'int'), int(7)], 'int');
      return caseOf([[cond('eq', [cast(q, 'int'), int(2)]), pop('add', [monday, int(1)], 'int')], [cond('eq', [cast(q, 'int'), int(3)]), monday]], pop('add', [d, int(1)], 'int'), 'int');
    }
    case 'date': return call('add_days', [call('add_months', [call('make_date', [cast(p, 'int'), int(1), int(1)], 'date'), pop('sub', [cast(q, 'int'), int(1)], 'int')], 'date'), pop('sub', [cast(s, 'int'), int(1)], 'int')], 'date');
    // A time is a date and time on day zero; hours, minutes and seconds past a day carry, the
    // day they make dropped.
    case 'time': {
      const secs = pop('add', [pop('add', [pop('mul', [cast(p, 'int'), int(3600)], 'int'), pop('mul', [cast(q, 'int'), int(60)], 'int')], 'int'), cast(s, 'double')], 'double');
      const day = pop('sub', [secs, pop('mul', [lit(86400, 'int'), call('floor', [pop('div', [secs, lit(86400, 'int')], 'double')], 'double')], 'double')], 'double');
      return fromSerial(pop('div', [day, lit(86400, 'int')], 'double'));
    }
    case 'date_serial': return serial(cast(p, 'datetime'));
    case 'serial_date': return fromSerial(p);
    case 'roundup': { const k = call('power', [int(10), q], 'double'); return pop('div', [pop('mul', [call('sign', [p], 'int'), call('ceil', [g15(pop('mul', [call('abs', [p], 'double'), k], 'double'))], 'double')], 'double'), k], 'double'); }
    case 'rounddown': case 'trunc': { const k = call('power', [int(10), q], 'double'); return pop('div', [call('trunc', [g15(pop('mul', [p, k], 'double'))], 'double'), k], 'double'); }
    case 'ceiling': case 'floor': {
      const f = x.name === 'ceiling' ? 'ceil' : 'floor';
      return q ? pop('mul', [call(f, [g15(pop('div', [p, q], 'double'))], 'double'), q], 'double') : call(f, [p], 'double');
    }
    case 'mround': return pop('mul', [halfAway(pop('div', [p, q], 'double')), q], 'double');
    // FORMAT: a number or a date by a pattern (parsed: its sections, digits, separators, the
    // names of days and months), as text; COMBINEVALUES: values joined by a separator.
    // FORMAT: the pattern (parsed, as JSON) written out as standard functions (text.js).
    // (Its name and arguments kept beside: an engine with a FORMAT of its own may write that.)
    case 'format_number': return P.defined('format_number', a, DEF.formatNumber(a[0], JSON.parse(x.a[1].v), x.a[0].t));
    case 'format_date': return P.defined('format_date', a, DEF.formatDate(a[0], JSON.parse(x.a[1].v)));
    case 'combinevalues': return DEF.combineValues(T(0), a.slice(1).map(asText));
    case 'year': case 'month': case 'day': case 'hour': case 'minute': case 'second': case 'quarter':
      return isDate(p.t) ? call(`extract_${x.name}`, [p], 'int') : keep();
    case 'cast': {
      const to = q?.v;
      // Text as a date: an ISO literal (YYYY-MM-DD) a cast; else parse_datetime (DAX's en-US
      // forms too: 3/5/2024, March 5, 2024), as each dialect reads it.
      if (to === 'datetime' && p.t === 'string') return p.k === 'lit' && /^\d{4}-\d\d-\d\d([ T]\d\d:\d\d(:\d\d)?)?$/.test(p.v) ? cast(p, to) : DEF.parseDatetime(p);
      if (to === 'string') return asText(p);
      return ['int', 'double', 'decimal', 'bool', 'datetime'].includes(to) ? cast(p, to) : keep();
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
    // Weeks that start on Sunday (as SQL Server's DATEDIFF counts them).
    case 'datediff': {
      if (UNIT(s) === 'week') return call('idiv', [call('date_diff_day', [call('add_days', [p, pop('neg', [dow(p)], 'int')], 'date'), call('add_days', [q, pop('neg', [dow(q)], 'int')], 'date')], 'int'), int(7)], 'int');
      return ['day', 'month', 'quarter', 'year', 'hour', 'minute', 'second'].includes(UNIT(s)) ? call(`date_diff_${UNIT(s)}`, [p, q], 'int') : keep();
    }
  }
  return keep();
}
