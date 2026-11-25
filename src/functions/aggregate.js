// Aggregates and iterators, CALCULATE, and the functions that ask about the filter context.
// An aggregate is { k:'agg' } over a table (a scan of the column's table, for SUM(T[c])).
import * as ir from '../ir.js';
import { parseExpression } from '../parser.js';
import { semantic } from '../errors.js';

const lc = s => String(s).toLowerCase();
const numType = t => (t === 'int' || t === 'decimal' ? t : 'double');

// SUM(T[c]) and its kind: the column's table, as the filter context leaves it.
function overColumn(c, ast, env, what) {
  const col = c.modelColumn(ast, env, what);
  const src = c.scan(col.table, env.ctx), row = ir.rowOf(src);
  return { src, row, arg: ir.col(row, col), col };
}
// SUMX(table, expr) and its kind: expr in a row context of the table.
function overTable(c, args, env) {
  // SUMX(CURRENTGROUP(), expr) inside GROUPBY: the rows of the group.
  if (args[0]?.k === 'call' && args[0].fn === 'CURRENTGROUP') {
    if (!env.currentGroup) throw semantic('CURRENTGROUP() is only valid inside GROUPBY');
    const { row } = env.currentGroup, inner = { ...env, rows: [...env.rows, row], currentGroup: null };
    return { src: { k: 'currentgroup', cols: row.cols }, row, arg: c.scalar(args[1], inner), inner };
  }
  const src = c.table(args[0], env), row = ir.rowOf(src);
  const inner = c.iter(env, row);
  return { src, row, arg: c.scalar(args[1], inner), inner };
}

const column = (fn, type) => (c, args, env) => {
  const { src, row, arg } = overColumn(c, args[0], env);
  return ir.agg(fn, src, row, arg, type(arg.t));
};
// MINX and MAXX of text are text, but a measure of them is declared a variant (`decl`: the
// type a measure of the expression has, where it is not the expression's; see measureRef).
const iterator = (fn, type) => (c, args, env) => {
  const { src, row, arg } = overTable(c, args, env);
  const x = ir.agg(fn, src, row, arg, type(arg.t));
  return (fn === 'min' || fn === 'max') && arg.t === 'string' ? { ...x, decl: 'variant' } : x;
};
const same = t => t, num = t => numType(t), dbl = () => 'double', int = () => 'int';

function countRows(c, args, env) {
  const a = args[0];
  if (!a) throw semantic('COUNTROWS needs a table');
  // COUNTROWS(VALUES(T[c])) and COUNTROWS(SUMMARIZE(T, cols)) count distinct values: the
  // same aggregate as DISTINCTCOUNT, over the table.
  if (a.k === 'call' && (a.fn === 'VALUES' || a.fn === 'DISTINCT') && a.args.length === 1 && a.args[0].k === 'col' && a.args[0].table
    && c.model.findColumn(a.args[0].table, a.args[0].name)) {
    const { src, row, arg } = overColumn(c, a.args[0], env);
    return ir.agg('dcount', src, row, arg, 'int');
  }
  if (a.k === 'call' && a.fn === 'SUMMARIZE' && a.args.length > 1 && a.args.slice(1).every(x => x.k === 'col' && x.table)
    && a.args[0].k === 'name' && !env.vars.has(lc(a.args[0].name)) && c.model.hasTable(a.args[0].name)) {
    const src = c.scan(c.model.table(a.args[0].name), env.ctx), row = ir.rowOf(src);
    const cols = a.args.slice(1).map(x => ir.col(row, c.modelColumn(x, env)));
    return ir.agg('dcount', src, row, cols.length === 1 ? cols[0] : ir.fn('row', cols, 'variant', { nn: true }), 'int');
  }
  const src = c.table(a, env);
  return ir.agg('countrows', src, ir.rowOf(src), null, 'int');
}

// DISTINCTCOUNT(T[c]): the distinct values of T's rows, a blank one of them.
function distinctCount(c, args, env) {
  return column('dcount', int)(c, args, env);
}

function minMax(fn) {
  return (c, args, env) => {
    if (args.length === 2) {
      // MAX(a, b): a blank compares as 0 or "" (MAX(-1, BLANK()) is the blank); of two that
      // compare equal, the one that is not blank (MAX(BLANK(), 0) is 0).
      const a = c.scalar(args[0], env), b = c.scalar(args[1], env), t = ir.unify([a.t, b.t]);
      const op = fn === 'max' ? 'gt' : 'lt';
      return ir.kase([[ir.op(op, a, b), a], [ir.op(op, b, a), b]], ir.fn('coalesce', [a, b], t), t);
    }
    return column(fn, same)(c, args, env);
  };
}

function concatenateX(c, args, env) {
  const { src, row, arg, inner } = overTable(c, args, env);
  const delim = args[2] && args[2].k !== 'empty' ? c.scalar(args[2], env) : ir.lit('', 'string');
  const order = [];
  for (let i = 3; i < args.length; i += 2) {
    const d = args[i + 1];
    order.push({ expr: c.scalar(args[i], inner), desc: !!d && isDesc(d, false) });
  }
  const node = ir.agg('concat', src, row, arg, 'string', [delim]);
  node.order = order;
  return node;
}

// ASC/DESC (or 1/0, TRUE/FALSE) as an argument.
export function isDesc(ast, dflt) {
  if (!ast || ast.k === 'empty') return dflt;
  if (ast.k === 'name') {
    const n = ast.name.toUpperCase();
    if (n === 'DESC') return true;
    if (n === 'ASC') return false;
  }
  if (ast.k === 'num') return Number(ast.v) === 0;
  if (ast.k === 'bool') return !ast.v;
  throw semantic('expected ASC or DESC');
}

// PERCENTILE.INC/EXC rank a column's values, its blanks left out; PERCENTILEX.INC/EXC rank
// the expression's value on every row, a blank among them (pctx_). MEDIANX is PERCENTILEX.INC
// at 0.5, its blanks counted too; MEDIAN leaves a column's blanks out.
function percentile(fn, x) {
  return (c, args, env) => {
    const o = x ? overTable(c, args, env) : overColumn(c, args[0], env);
    const k = c.scalar(args[x ? 2 : 1], env);
    return ir.agg(x ? fn.replace('pct_', 'pctx_') : fn, o.src, o.row, o.arg, 'double', [k]);
  };
}
function medianX(c, args, env) {
  const { src, row, arg } = overTable(c, args, env);
  return ir.agg('pctx_inc', src, row, arg, 'double', [ir.lit(0.5)]);
}

// The average of fixed decimals (currency) is one: their sum over their count, the exact quotient
// rounded to four places, half away from zero (ir.op's fixed decimal over a whole number), as
// Power BI has it (tpcds check-average-fixed-decimal-half: 409.59125 is 409.5913), not a double's
// average rounded, which falls short of a half or not as its last bit does (DuckDB and Polars at
// SF1 parted on 79 groups of tpcds fuzz-0013 so).
const average = make => (c, args, env) => {
  const x = make('avg', dbl)(c, args, env);
  if (x.arg.t !== 'decimal') return x;
  return ir.op('div', { ...x, fn: 'sum', t: 'decimal' }, { ...x, fn: 'count', t: 'int' });
};

// --- the filter context ----------------------------------------------------------------

function calculate(c, args, env) {
  if (!args.length) throw semantic('CALCULATE needs an expression');
  if (env.boolFilter) throw semantic('a True/False filter of CALCULATE cannot use CALCULATE: it has to be FILTER over a table');
  const ctx = c.calculateCtx(args.slice(1), env);
  // Inside CALCULATE the row contexts are filters now: no row context is left.
  return c.scalar(args[0], { ...env, ctx, rows: [], grouped: c.scopeIn(env.grouped, ctx) });
}

// A column or a table argument -> the model columns it names.
function columnsOf(c, ast, env) {
  if (ast.k === 'col') return [c.modelColumn(ast, env)];
  if (ast.k === 'name' && c.model.hasTable(ast.name) && !env.vars.has(lc(ast.name))) return c.model.table(ast.name).columns;
  throw semantic('expected a column or a table');
}

function isFiltered(c, args, env) {
  const cols = columnsOf(c, args[0], env);
  return ir.lit(cols.some(x => env.ctx.filtered(x)));
}
function isCrossFiltered(c, args, env) {
  const cols = columnsOf(c, args[0], env), table = cols[0].table;
  const state = c.model.state(env.ctx.mods);
  const hit = env.ctx.filters.some(f => f.cols.some(x => c.model.reaches(x.table, table, state)));
  return ir.lit(hit);
}
function isInScope(c, args, env) {
  return ir.lit(env.grouped.has(c.modelColumn(args[0], env)));
}

// ISSUBTOTAL(T[c]) in an expression of SUMMARIZE: whether its row is a subtotal over the
// column (a level of ROLLUP without it).
function isSubtotal(c, args, env) {
  if (!env.rolledUp) throw semantic('ISSUBTOTAL is only valid in the expressions of SUMMARIZE');
  return ir.lit(env.rolledUp.has(c.modelColumn(args[0], env)));
}

// The visible values of a column: one of them, or whether there is exactly one.
// The values of a column in the filter context (HASONEVALUE, SELECTEDVALUE): its table's rows.
function valuesOf(c, ast, env) {
  const col = c.modelColumn(ast, env);
  const src = c.scan(col.table, env.ctx), row = ir.rowOf(src);
  return { src, row, col, value: ir.col(row, col) };
}
function hasOneValue(c, args, env) {
  const { src, row, value } = valuesOf(c, args[0], env);
  return ir.agg('hasone', src, row, value, 'bool');
}
function selectedValue(c, args, env) {
  const { src, row, value } = valuesOf(c, args[0], env);
  const alt = args[1] && args[1].k !== 'empty' ? c.scalar(args[1], env) : ir.BLANK;
  return ir.kase([[ir.agg('hasone', src, row, value, 'bool'), ir.agg('min', src, row, value, value.t)]], alt);
}
function hasOneFilter(c, args, env) {
  const col = c.modelColumn(args[0], env);
  if (!env.ctx.filtered(col)) return ir.FALSE;
  const t = filtersTable(c, col, env);
  const row = ir.rowOf(t);
  return ir.op('eq', ir.agg('countrows', t, row, null, 'int'), ir.lit(1));
}
// FILTERS(T[c]): the values the filters directly on the column allow.
export function filtersTable(c, col, env) {
  const direct = env.ctx.filters.filter(f => f.cols.includes(col));
  const ctx = new env.ctx.constructor(direct, env.ctx.mods);
  const src = c.scan(col.table, ctx), row = ir.rowOf(src);
  return ir.distinct(ir.project(src, row, [ir.itemOf(row, col)]));
}

// LOOKUPVALUE(result, search, value, ..., alternate): the result column on the rows where each
// search column holds its value, searched without the filter context (row-level security still
// applies), or the alternate (blank) when it holds no single value.
function lookupValue(c, args, env) {
  const result = c.modelColumn(args[0], env);
  let ctx = env.ctx.removeAll(), i = 1;
  for (; i + 1 < args.length; i += 2) {
    const s = c.modelColumn(args[i], env), v = c.scalar(args[i + 1], env);
    ctx = ctx.add({ kind: 'bind', cols: [s], val: v });
  }
  const alt = i < args.length && args[i].k !== 'empty' ? c.scalar(args[i], env) : ir.BLANK;
  const src = c.scan(result.table, ctx), row = ir.rowOf(src), value = ir.col(row, result);
  return ir.kase([[ir.agg('hasone', src, row, value, 'bool'), ir.agg('min', src, row, value, value.t)]], alt);
}

// RELATED follows the active relationships, whichever way they filter, but not one CROSSFILTER
// turns off (None): there is no relationship to follow then.
function related(c, args, env) {
  const col = c.modelColumn(args[0], env, 'RELATED needs a column');
  const state = c.model.state(env.ctx.mods);
  const off = new Set(state.filter(s => env.ctx.mods?.cross?.get(s.rel.name) === 'none').map(s => s.rel));
  const path = from => {
    const p = c.model.expand(from, state, null, true).get(col.table.name);
    return p && !p.some(h => off.has(h.rel)) ? p : null;
  };
  for (let i = env.rows.length - 1; i >= 0; i--) {
    const row = env.rows[i];
    if (row.base && path(row.base)) return ir.col(row, col);
    // A row of another table that holds the key of a model table: from there.
    for (const rc of row.cols) {
      if (!rc.lineage) continue;
      const p = path(rc.lineage.table);
      if (p?.length && row.cols.some(x => x.lineage === p[0].from)) return ir.col(row, col);
    }
  }
  throw semantic(`RELATED('${col.table.name}'[${col.name}]): no row context reaches '${col.table.name}' through a relationship`);
}

function earlier(c, args, env, ast) {
  const outermost = ast.fn === 'EARLIEST';
  const n = args[1] ? Number(args[1].v) : 1;
  const a = args[0];
  const matches = [];
  for (let i = env.rows.length - 1; i >= 0; i--) {
    const x = c.rowColumn({ ...env, rows: [env.rows[i]] }, a.table, a.name);
    if (x) matches.push(x);
  }
  const pick = outermost ? matches.at(-1) : matches[n];
  if (!pick) throw semantic(`${ast.fn}: there is no outer row context with '${a.table ?? ''}'[${a.name}]`);
  return pick;
}

function rankX(c, args, env) {
  const over = overTable(c, args, env), { src, row } = over;
  // The two values compared are the same measure written twice: their floating-point sums are
  // added exactly (passes/exact.js), or a row could rank below itself by a last digit.
  const same = x => (x.k === 'lit' ? x : ir.fn('same', [x], x.t, { nn: x.nn }));
  const arg = same(over.arg);
  const value = same(args[2] && args[2].k !== 'empty' ? c.scalar(args[2], env) : c.scalar(args[1], env));
  const desc = isDesc(args[3], true);
  const dense = args[4] && args[4].k === 'name' && args[4].name.toUpperCase() === 'DENSE';
  const ahead = ir.op(desc ? 'gt' : 'lt', arg, value);
  const fallback = rankCount(arg, value, src, row, ahead, dense);
  const w = byWindow(c, args, env);
  if (w) return { k: 'rankw', ...w, expr: value, all: src, desc, dense, fallback, t: 'int', nn: true };
  return pruned(c, args, env, value, desc, dense, same, src, row) ?? fallback;
}

// RANKX(ALL(T[c]), e) where e is blank whenever T has no rows (blankWithout): a value of T[c] that
// the context leaves no row of T for (its filters on T[c] aside) is a blank, 0 as RANKX compares
// it, so e is computed for the values the context leaves rows for (VALUES(T[c]), its own filters
// on T[c] removed: a few for each row) and the others are counted, not computed for each row and
// each value (tpcds fuzz2-0109: each group's YoY at every one of 2,689 prices, 17.5 million, where
// a group's color and classes leave a handful). -> the rank, or null when e may be non-blank so.
function pruned(c, args, env, value, desc, dense, same, allSrc, allRow) {
  const t = args[0];
  if ((args[2] && args[2].k !== 'empty') || t?.k !== 'call' || t.fn !== 'ALL' || t.args.length !== 1 || t.args[0].k !== 'col' || !t.args[0].table) return null;
  const col = c.model.findColumn(t.args[0].table, t.args[0].name);
  if (!col || col.expr) return null;
  const T = col.table, state = c.model.state(env.ctx.mods);
  if (!blankWithout(c, args[1], T, state, new Set())) return null;
  const src = ir.values(T, env.ctx.remove(x => x === col), [col], (tb, x) => c.scan(tb, x));
  const row = ir.rowOf(src);
  const arg = same(c.scalar(args[1], c.iter(env, row)));
  const ahead = ir.op(desc ? 'gt' : 'lt', arg, value);
  const count = (s, r, cond) => ir.agg('count0', s, r, ir.kase([[cond, ir.lit(1)]], ir.BLANK, 'int'), 'int');
  // The values of ALL(T[c]) left out: blanks, ahead of the value when 0 is.
  const blanks = ir.op('sub', ir.agg('count0', allSrc, allRow, ir.lit(1), 'int'), ir.agg('count0', src, row, ir.lit(1), 'int'));
  const blankAhead = ir.op(desc ? 'gt' : 'lt', ir.BLANK, value);
  if (!dense) return ir.op('add', ir.op('add', count(src, row, ahead), ir.kase([[blankAhead, blanks]], ir.lit(0), 'int')), ir.lit(1));
  const isDefault = ir.op('eq', arg, ir.BLANK);
  const distinct = ir.agg('dcount0', src, row, ir.kase([[ir.op('and', ahead, ir.op('not', isDefault)), arg]], ir.BLANK, arg.t), 'int');
  const defaultAhead = ir.op('or', ir.op('gt', count(src, row, ir.op('and', ahead, isDefault)), ir.lit(0)), ir.op('and', blankAhead, ir.op('gt', blanks, ir.lit(0))));
  return ir.op('add', ir.op('add', distinct, ir.kase([[defaultAhead, ir.lit(1)]], ir.lit(0), 'int')), ir.lit(1));
}

// Whether expression x (DAX) is blank whenever table T has no rows in its context: aggregates of
// tables T filters (a fact by its dimension), their sums and differences, a product or quotient of
// one, DIVIDE of one, CALCULATE of one under filters that leave T's as they are (time intelligence
// on another table, filters on other tables, ALL of a table T does not filter); measures read
// through. Anything else (a constant, IF, a filter on T or removing it): not known, false.
const BLANK_AGGS = new Set(['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'COUNTROWS', 'DISTINCTCOUNT', 'DISTINCTCOUNTNOBLANK',
  'SUMX', 'AVERAGEX', 'MINX', 'MAXX', 'COUNTX', 'COUNTAX', 'PRODUCT', 'PRODUCTX']);
const TIME_FILTERS = new Set(['SAMEPERIODLASTYEAR', 'DATEADD', 'DATESYTD', 'DATESQTD', 'DATESMTD', 'PARALLELPERIOD', 'PREVIOUSDAY',
  'PREVIOUSMONTH', 'PREVIOUSQUARTER', 'PREVIOUSYEAR', 'NEXTDAY', 'NEXTMONTH', 'NEXTQUARTER', 'NEXTYEAR', 'DATESINPERIOD', 'DATESBETWEEN']);
const REMOVERS = new Set(['ALL', 'ALLEXCEPT', 'ALLSELECTED', 'ALLNOBLANKROW', 'REMOVEFILTERS', 'ALLCROSSFILTERED']);
function blankWithout(c, x, T, state, seen) {
  const m = c.model, bw = y => blankWithout(c, y, T, state, seen);
  const tableOf = a => (a?.k === 'col' && a.table ? m.table(a.table) : a?.k === 'name' ? m.table(a.name) : null);
  const cols = (y, out = []) => {
    if (!y || typeof y !== 'object') return out;
    if (y.k === 'col') out.push(y);
    for (const v of Object.values(y)) if (v && typeof v === 'object') Array.isArray(v) ? v.forEach(z => cols(z, out)) : cols(v, out);
    return out;
  };
  const keepsT = f => {
    if (f.k === 'call' && f.fn === 'KEEPFILTERS') return keepsT(f.args[0]);
    if (f.k === 'call' && TIME_FILTERS.has(f.fn)) { const tb = tableOf(f.args[0]); return !!tb && tb !== T && !m.reaches(tb, T, state); }
    if (f.k === 'call' && REMOVERS.has(f.fn)) return f.args.every(a => { const tb = tableOf(a); return !!tb && tb !== T && !m.reaches(T, tb, state); });
    if (f.k === 'bin') return cols(f).every(y => { const tb = y.table ? m.table(y.table) : null; return !!tb && tb !== T && !m.reaches(tb, T, state); });
    return false;
  };
  switch (x?.k) {
    case 'col': {
      const me = m.measure(x.name);
      if (!me || (x.table && m.findColumn(x.table, x.name)) || seen.has(me)) return false;
      // seen: the measures being read (a measure that names itself is not known); one read twice
      // (YoY: the revenue and the revenue of the year before) is read again.
      seen.add(me);
      me.ast ??= parseExpression(me.text);
      try { return bw(me.ast); } finally { seen.delete(me); }
    }
    case 'neg': return bw(x.e);
    case 'bin':
      if (x.op === '+' || x.op === '-') return bw(x.l) && bw(x.r);
      if (x.op === '*') return bw(x.l) || bw(x.r);
      if (x.op === '/') return bw(x.l);
      return false;
    case 'call':
      if (x.fn === 'BLANK') return true;
      if (BLANK_AGGS.has(x.fn)) { const tb = tableOf(x.args[0]); return !!tb && (tb === T || m.reaches(T, tb, state)); }
      if (x.fn === 'DIVIDE') return x.args.length === 2 && (bw(x.args[0]) || bw(x.args[1]));
      if (x.fn === 'CALCULATE') return bw(x.args[0]) && x.args.slice(1).every(keepsT);
      return false;
  }
  return false;
}

// RANKX(ALL(T[c]), e) as an expression of a SUMMARIZECOLUMNS level that groups by T[c] (its
// context the level's own, no row context, no other filter on T[c]; e a measure or CALCULATE): each row of ALL(T[c]) is
// the level's group with that value of T[c] (context transition replaces the group's), so the
// values ranked are e of the level's groups by every key, partitioned by the other keys; lowered
// as a window over them (lower.js rankWindow), not e computed for each group and each value.
// -> { keyRow, key } (the key's position), or null.
function byWindow(c, args, env) {
  const kr = env.ctx.level;
  if (!kr || env.rows.length || env.currentGroup || (args[2] && args[2].k !== 'empty')) return null;
  // The value of a row of ALL(T[c]) is the group's with that T[c] only by a context transition:
  // a measure, or CALCULATE (MIN(x) alone is the outer group's value for every row).
  const e = args[1];
  const measure = e?.k === 'col' && c.model.measure(e.name) && (!e.table || !c.model.findColumn(e.table, e.name))
    && !(e.table && (env.vars.get(e.table.toLowerCase()) || env.queryTables?.get(e.table.toLowerCase())));
  if (!measure && !(e?.k === 'call' && e.fn === 'CALCULATE')) return null;
  const t = args[0];
  if (t?.k !== 'call' || t.fn !== 'ALL' || t.args.length !== 1 || t.args[0].k !== 'col' || !t.args[0].table) return null;
  const col = c.model.findColumn(t.args[0].table, t.args[0].name);
  if (!col) return null;
  // Auto-exist's combinations of the filters on T[c]'s table hold T[c] only as a key (keyOnly):
  // the level's groups are of those rows, as the values ranked are. Its tie of them to the group
  // (with `keys`) is not: narrowed to the other columns, it keeps the outer group's rows of them.
  const on = env.ctx.filters.filter(f => (f.cols.includes(col) || f.keys?.includes(col)) && !(f.keyOnly?.includes(col) && !f.keys));
  if (on.length !== 1 || on[0].kind !== 'bind' || on[0].val.k !== 'col' || on[0].val.row !== kr) return null;
  return { keyRow: kr, key: on[0].val.ref };
}

function rankCount(arg, value, src, row, ahead, dense) {
  if (!dense) return ir.op('add', ir.agg('count0', src, row, ir.kase([[ahead, ir.lit(1)]], ir.BLANK, 'int'), 'int'), ir.lit(1));
  // DENSE: the distinct values ahead. RANKX compares a blank as its type's default (0, ""),
  // so a blank and the default are one value: the other values ahead counted apart, and one
  // more when a blank or the default is ahead (ascending, it is ahead of every positive
  // value), though a distinct count of SQL would leave the blank out.
  const isDefault = ir.op('eq', arg, ir.BLANK);
  const distinct = ir.agg('dcount0', src, row, ir.kase([[ir.op('and', ahead, ir.op('not', isDefault)), arg]], ir.BLANK, arg.t), 'int');
  const defaultAhead = ir.agg('count0', src, row, ir.kase([[ir.op('and', ahead, isDefault), ir.lit(1)]], ir.BLANK, 'int'), 'int');
  const blank = ir.kase([[ir.op('gt', defaultAhead, ir.lit(0)), ir.lit(1)]], ir.lit(0), 'int');
  return ir.op('add', ir.op('add', distinct, blank), ir.lit(1));
}

function contains(c, args, env) {
  const src = c.table(args[0], env), row = ir.rowOf(src), inner = c.iter(env, row);
  let pred = ir.TRUE;
  for (let i = 1; i + 1 < args.length; i += 2) pred = ir.op('and', pred, ir.op('eq', c.scalar(args[i], inner), c.scalar(args[i + 1], env)));
  return ir.exists(ir.filter(src, row, pred));
}
function containsRow(c, args, env) {
  const src = c.table(args[0], env);
  const vals = args.slice(1).map(a => c.scalar(a, env));
  if (vals.length !== src.cols.length) throw semantic('CONTAINSROW needs one value per column of the table');
  return { k: 'insub', e: vals, src, t: 'bool', nn: true };
}
function isEmpty(c, args, env) { return ir.op('not', ir.exists(c.table(args[0], env))); }

// Calculation items: the measure they are applied to.
function selectedMeasure(c, args, env) { return c.selectedMeasure(env); }
function inItem(env, fn) {
  if (!env.cg) throw semantic(`${fn}() is only valid in a calculation item`);
  return env.cg.measure;
}
function selectedMeasureName(c, args, env) { return ir.lit(inItem(env, 'SELECTEDMEASURENAME').name, 'string'); }
function selectedMeasureFormat(c, args, env) {
  const f = inItem(env, 'SELECTEDMEASUREFORMATSTRING').formatString;
  return f == null ? ir.BLANK : ir.lit(f, 'string');
}
function isSelectedMeasure(c, args, env) {
  const m = inItem(env, 'ISSELECTEDMEASURE');
  return ir.lit(args.some(a => a.k === 'col' && lc(a.name) === lc(m.name)));
}
function nameOf(c, args) {
  if (args[0]?.k !== 'col') throw semantic('NAMEOF takes a column or a measure');
  return ir.lit(c.model.nameOf(args[0]), 'string');
}

export const scalar = {
  SELECTEDMEASURE: selectedMeasure, SELECTEDMEASURENAME: selectedMeasureName,
  SELECTEDMEASUREFORMATSTRING: selectedMeasureFormat, ISSELECTEDMEASURE: isSelectedMeasure, NAMEOF: nameOf,
  SUM: column('sum', num), AVERAGE: average(column), MIN: minMax('min'), MAX: minMax('max'),
  COUNT: column('count', int), COUNTA: column('count', int), COUNTBLANK: column('countblank', int),
  DISTINCTCOUNT: distinctCount, DISTINCTCOUNTNOBLANK: column('dcountnb', int),
  PRODUCT: column('product', num), MEDIAN: column('median', dbl),
  'STDEV.S': column('stdev_s', dbl), 'STDEV.P': column('stdev_p', dbl), 'VAR.S': column('var_s', dbl), 'VAR.P': column('var_p', dbl),
  MINA: minMax('min'), MAXA: minMax('max'), AVERAGEA: average(column),
  SUMX: iterator('sum', num), AVERAGEX: average(iterator), MINX: iterator('min', same), MAXX: iterator('max', same),
  COUNTX: iterator('count', int), COUNTAX: iterator('count', int), PRODUCTX: iterator('product', num), MEDIANX: medianX,
  'STDEVX.S': iterator('stdev_s', dbl), 'STDEVX.P': iterator('stdev_p', dbl), 'VARX.S': iterator('var_s', dbl), 'VARX.P': iterator('var_p', dbl),
  'PERCENTILE.INC': percentile('pct_inc', false), 'PERCENTILE.EXC': percentile('pct_exc', false),
  'PERCENTILEX.INC': percentile('pct_inc', true), 'PERCENTILEX.EXC': percentile('pct_exc', true),
  COUNTROWS: countRows, CONCATENATEX: concatenateX, RANKX: rankX,
  CALCULATE: calculate,
  ISFILTERED: isFiltered, ISCROSSFILTERED: isCrossFiltered, ISINSCOPE: isInScope, ISSUBTOTAL: isSubtotal,
  HASONEVALUE: hasOneValue, HASONEFILTER: hasOneFilter, SELECTEDVALUE: selectedValue,
  LOOKUPVALUE: lookupValue, RELATED: related, EARLIER: earlier, EARLIEST: earlier,
  CONTAINS: contains, CONTAINSROW: containsRow, ISEMPTY: isEmpty,
};
