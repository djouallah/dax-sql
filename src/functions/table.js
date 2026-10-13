// Table functions, the CALCULATE modifiers (ALL and its kind, USERELATIONSHIP, CROSSFILTER),
// and SUMMARIZECOLUMNS.
import * as ir from '../ir.js';
import { rowsTable } from '../ir.js';
import { Ctx } from '../context.js';
import { semantic, unsupported } from '../errors.js';
import { isDesc, filtersTable } from './aggregate.js';

const lc = s => String(s).toLowerCase();
const isModelTableName = (c, ast, env) => ast.k === 'name' && !env.vars.has(lc(ast.name)) && !env.queryTables.has(lc(ast.name)) && c.model.hasTable(ast.name);
const noFilters = ctx => new Ctx([], ctx.mods);

// "name", expression, "name", expression ... from argument `from` on.
function pairs(args, from, what) {
  const out = [];
  for (let i = from; i < args.length; i += 2) {
    if (args[i].k !== 'str' || !args[i + 1]) throw semantic(`${what} expects "name", expression pairs`);
    out.push([args[i].v, args[i + 1]]);
  }
  return out;
}

// An item of SELECTCOLUMNS or ADDCOLUMNS: a plain column keeps its lineage.
function item(c, name, ast, env) {
  const expr = c.scalar(ast, env);
  const lineage = expr.k === 'col' ? (typeof expr.ref === 'number' ? expr.row.cols[expr.ref].lineage : expr.ref) : null;
  return { name, expr, lineage, t: expr.t };
}

// --- reading the model ------------------------------------------------------------------

// The blank row: VALUES and ALL (and its kind) list it; DISTINCT, ALLNOBLANKROW and a table
// named on its own do not.
const blankOf = (c, t, fn) => fn !== 'ALLNOBLANKROW' && fn !== 'DISTINCT' && c.blankRowRels(t).length > 0;
const rowsOf = (c, t, ctx, fn) => {
  const s = c.scan(t, ctx);
  return blankOf(c, t, fn) ? ir.withBlank(s, t, ctx) : s;
};

function all(c, args, env, ast) {
  if (!args.length) throw semantic(`${ast.fn}() with no argument is only valid as a CALCULATE filter`);
  if (args.length === 1 && isModelTableName(c, args[0], env)) return rowsOf(c, c.model.table(args[0].name), noFilters(env.ctx), ast.fn);
  // ALL(T[a], T[b]): the combinations of values the table holds, filters ignored.
  const cols = args.map(a => c.modelColumn(a, env));
  const t = cols[0].table;
  if (cols.some(x => x.table !== t)) throw semantic(`${ast.fn} takes columns of one table`);
  return ir.values(t, noFilters(env.ctx), cols, (tb, ctx) => c.scan(tb, ctx), blankOf(c, t, ast.fn));
}

function allExcept(c, args, env) {
  if (!isModelTableName(c, args[0], env)) throw semantic('ALLEXCEPT(table, column, ...)');
  const t = c.model.table(args[0].name), keep = new Set(args.slice(1).map(a => c.modelColumn(a, env)));
  const exp = c.expandedColumns(t, env.ctx);
  return rowsOf(c, t, env.ctx.remove(x => exp.has(x) && !keep.has(x)), 'ALLEXCEPT');
}

// ALLSELECTED as a table. Of a table: its rows, the columns some shadow filter context covers
// filtered as the last such says, the others as the filter context says. Of columns: their
// values under the last shadow on them only (all their values when there is none).
function allSelected(c, args, env) {
  if (!args.length) throw semantic('ALLSELECTED() with no argument is only valid as a CALCULATE filter');
  if (args.length === 1 && isModelTableName(c, args[0], env)) {
    const t = c.model.table(args[0].name);
    return rowsOf(c, t, c.allSelected(env.ctx, env, c.expandedColumns(t, env.ctx)), 'ALLSELECTED');
  }
  const list = args.map(a => c.modelColumn(a, env));
  if (list.some(x => x.table !== list[0].table)) throw semantic('ALLSELECTED takes columns of one table');
  const ctx = c.allSelected(noFilters(env.ctx), env, new Set(list), true);
  return ir.values(list[0].table, ctx, list, (tb, x) => c.scan(tb, x), blankOf(c, list[0].table, 'ALLSELECTED'));
}

function valuesFn(c, args, env, ast) {
  const a = args[0];
  if (isModelTableName(c, a, env)) {
    const t = c.model.table(a.name), d = ir.distinct(c.scan(t, env.ctx));
    return blankOf(c, t, ast.fn) ? ir.withBlank(d, t, env.ctx) : d;
  }
  if (a.k === 'col' && a.table && c.model.findColumn(a.table, a.name)) {
    const col = c.modelColumn(a, env);
    return ir.values(col.table, env.ctx, [col], (tb, ctx) => c.scan(tb, ctx), blankOf(c, col.table, ast.fn));
  }
  return ir.distinct(c.table(a, env));
}

function calculateTable(c, args, env) {
  const ctx = c.calculateCtx(args.slice(1), env);
  return c.table(args[0], { ...env, ctx, rows: [] });
}

function relatedTable(c, args, env) {
  if (!isModelTableName(c, args[0], env)) throw semantic('RELATEDTABLE(table)');
  return c.scan(c.model.table(args[0].name), c.transition(env));
}

function filterFn(c, args, env) {
  const src = c.table(args[0], env), row = ir.rowOf(src);
  return ir.filter(src, row, c.scalar(args[1], c.iter(env, row)));
}

function addColumns(c, args, env) {
  const src = c.table(args[0], env), row = ir.rowOf(src), inner = c.iter(env, row);
  return ir.project(src, row, pairs(args, 1, 'ADDCOLUMNS').map(([n, x]) => item(c, n, x, inner)), true);
}

function selectColumns(c, args, env) {
  const src = c.table(args[0], env), row = ir.rowOf(src), inner = c.iter(env, row);
  const items = [];
  for (let i = 1; i < args.length;) {
    if (args[i].k === 'str') { items.push(item(c, args[i].v, args[i + 1], inner)); i += 2; continue; }
    // SELECTCOLUMNS(t, T[c]): named after the column.
    if (args[i].k !== 'col') throw semantic('SELECTCOLUMNS expects "name", expression pairs');
    items.push(item(c, args[i].name, args[i], inner));
    i++;
  }
  return ir.project(src, row, items);
}

// The columns of a table named by Table[Column] or [Column]: their positions.
function columnsIn(c, t, asts, env, what) {
  return asts.map(a => {
    if (a.k !== 'col') throw semantic(`${what} groups by columns`);
    let i = a.table ? t.cols.findIndex(x => x.lineage && lc(x.lineage.table.name) === lc(a.table) && lc(x.lineage.name) === lc(a.name)) : -1;
    if (i < 0) i = t.cols.findIndex(x => lc(x.name) === lc(a.name) && (!a.table || !x.lineage));
    if (i < 0 && a.table && t.base) {
      // A column of a related table, through the expanded table (SUMMARIZE(Sales, Product[Color])).
      const col = c.model.findColumn(a.table, a.name);
      if (col && c.model.expand(t.base, c.model.state(env.ctx.mods), null, true).has(col.table.name)) return col;
    }
    if (i < 0) throw semantic(`${what}: the table has no column ${a.table ? `'${a.table}'` : ''}[${a.name}]`);
    return i;
  });
}

// How a grouping column is read off a row: a model table's row by the model column, any
// other (or a column added to it) by position.
const keyRef = (row, src, r) => (row.kind === 'scan' && typeof r === 'number' && src.cols[r].lineage ? src.cols[r].lineage : r);

// SUMMARIZE(table, columns..., "name", expression, ...). With ROLLUP(columns...), each level
// of subtotals is the same with fewer of its columns, from the last: its rows are the groups
// of the columns that stay, the others blank, and ISSUBTOTAL(column) in an expression says
// whether the level took that column away. ROLLUPGROUP(columns...) in ROLLUP goes as one.
function summarize(c, args, env) {
  const src = c.table(args[0], env), row = ir.rowOf(src);
  const asts = [], roll = [];
  let i = 1, levels = 0;
  for (; i < args.length; i++) {
    const a = args[i];
    if (a.k === 'col') { asts.push(a); roll.push(-1); continue; }
    if (a.k !== 'call' || a.fn !== 'ROLLUP') break;
    for (const x of a.args) {
      const cols = x.k === 'call' && x.fn === 'ROLLUPGROUP' ? x.args : [x];
      for (const y of cols) { asts.push(y); roll.push(levels); }
      levels++;
    }
  }
  const refs = columnsIn(c, src, asts, env, 'SUMMARIZE');
  const keys = refs.map(r => ir.itemOf(row, keyRef(row, src, r)));
  const ext = pairs(args, i, 'SUMMARIZE');
  const level = j => {
    const on = keys.filter((_, n) => roll[n] < j);
    const grouped = on.length
      ? { k: 'group', src, row, keys: on, items: [], cols: on.map(k => ({ name: k.name, lineage: k.lineage, t: k.t })), base: null }
      // No column left: one row, when the table has one.
      : ir.distinct(ir.project(src, row, []));
    if (!ext.length) return { grouped, on };
    // Its expressions, as ADDCOLUMNS over the groups, each with its group as the filter
    // context (SUMMARIZE's own context transition) and its row. The group is its rows of the
    // table, not only its values: those rows filter the table (its expanded table, for a
    // model table's rows) as a table filter, so a filter that replaces or removes a grouping
    // column's (ALL('Date'[Year]), a filter on a date table's date) still keeps the group's
    // rows. A level with no column left has all the table's rows. ALLSELECTED, putting back
    // the groups' shadow, takes them away with the group's values.
    const grow = ir.rowOf(grouped, 'table');
    const rolledUp = new Set(keys.filter((_, n) => roll[n] >= j).map(k => k.lineage).filter(Boolean));
    const frow = ir.rowOf(src);
    const same = on.map((k, n) => ir.op('eqs', ir.col(frow, keyRef(frow, src, refs[keys.indexOf(k)])), ir.col(grow, n)));
    const rows = ir.filter(src, frow, same.reduce((a, b) => ir.op('and', a, b), ir.TRUE));
    let ctx = c.transitionRow(env.ctx, grow);
    for (const f of [c.tableFilter(rows, env.ctx)].flat().filter(Boolean)) ctx = ctx.add({ ...f, group: grow });
    const inner = { ...c.iter(env, grow), ctx, rolledUp };
    return { grouped, on, grow, items: ext.map(([n, x]) => item(c, n, x, inner)) };
  };
  if (!levels) {
    const { grouped, grow, items } = level(0);
    return ext.length ? ir.project(grouped, grow, items, true) : grouped;
  }
  // The levels, the detail first; a column a level took away is blank in its rows.
  const parts = [];
  for (let j = levels; j >= 0; j--) {
    const { grouped, on, grow, items = [] } = level(j);
    const g = grow ?? ir.rowOf(grouped, 'table');
    const cols = keys.map(k => {
      const n = on.indexOf(k);
      return { name: k.name, expr: n >= 0 ? ir.col(g, n) : ir.lit(null, k.t), lineage: k.lineage, t: k.t };
    });
    parts.push(ir.project(grouped, g, [...cols, ...items]));
  }
  return { k: 'union', srcs: parts, cols: parts[0].cols, base: null };
}

function groupBy(c, args, env) {
  const src = c.table(args[0], env), row = ir.rowOf(src);
  let i = 1;
  while (i < args.length && args[i].k === 'col') i++;
  const refs = columnsIn(c, src, args.slice(1, i), env, 'GROUPBY');
  const keys = refs.map(r => ir.itemOf(row, keyRef(row, src, r)));
  const inner = { ...env, rows: env.rows, currentGroup: { src, row } };
  const items = pairs(args, i, 'GROUPBY').map(([n, x]) => {
    const expr = c.scalar(x, inner);
    return { name: n, expr, t: expr.t };
  });
  return { k: 'group', src, row, keys, items, cols: [...keys, ...items].map(k => ({ name: k.name, lineage: k.lineage ?? null, t: k.t })), base: null };
}

function currentGroup(c, args, env) {
  if (!env.currentGroup) throw semantic('CURRENTGROUP() is only valid inside GROUPBY');
  return { k: 'currentgroup', cols: env.currentGroup.src.cols, group: env.currentGroup };
}

function topN(c, args, env) {
  const n = c.scalar(args[0], env), src = c.table(args[1], env), row = ir.rowOf(src);
  const inner = c.iter(env, row), order = [];
  for (let i = 2; i < args.length; i += 2) order.push({ expr: c.scalar(args[i], inner), desc: isDesc(args[i + 1], true) });
  if (!order.length) throw unsupported('TOPN without an order');
  return { k: 'topn', src, row, n, order, cols: src.cols, base: src.base };
}

// expression, [order], expression, [order] ... from argument `from` on, the order ASC or DESC
// (or 1, 0, TRUE, FALSE) and `desc` when left out.
function orderBy(c, args, from, env, desc) {
  const order = [];
  for (let i = from; i < args.length; i++) {
    const expr = c.scalar(args[i], env), d = args[i + 1];
    const given = d && (d.k === 'num' || d.k === 'bool' || d.k === 'empty' || d.k === 'name' && /^(ASC|DESC)$/i.test(d.name));
    order.push({ expr, desc: given ? isDesc(d, desc) : desc, t: expr.t });
    if (given) i++;
  }
  return order;
}

// TOPNSKIP(n, skip, table, order...): the rows after the first `skip`, n of them, in the
// order (DESC unless it says), ties broken by the rows' other columns. Rows equal in every
// column are one place in the order, all of them kept.
function topNSkip(c, args, env) {
  const n = c.scalar(args[0], env), skip = c.scalar(args[1], env), src = c.table(args[2], env), row = ir.rowOf(src);
  const order = orderBy(c, args, 3, c.iter(env, row), true);
  return { k: 'topnskip', src, row, n, skip, order, cols: src.cols, base: src.base };
}

// The columns two tables join on, as [left position, right position]: those of the same
// lineage, and those of the same name that both lack one. Those must be of the same kind of
// data type (DAX's: a variant is none of the others).
function joinColumns(l, r, what) {
  const on = [];
  l.cols.forEach((a, i) => {
    const j = r.cols.findIndex(b => (a.lineage ? b.lineage === a.lineage : !b.lineage && lc(b.name) === lc(a.name)));
    if (j < 0) return;
    const [ka, kb] = [a, r.cols[j]].map(kindOf);
    if (ka && kb && ka !== kb) throw semantic(`${what}: the join column [${a.name}] has different data types on the two sides (${ka}, ${kb})`);
    on.push([i, j]);
  });
  if (!on.length) throw semantic(`${what}: the tables have no column to join on (the same lineage, or the same name and none)`);
  return on;
}

// A column's kind of data type as DAX has it; null for a column of blanks.
function kindOf(col) {
  const t = col.dax ?? col.t;
  return !t || t === 'blank' ? null : ir.isNum(t) ? 'number' : t === 'date' ? 'datetime' : t;
}

// NATURALINNERJOIN(left, right), NATURALLEFTOUTERJOIN: the pairs of rows equal on the
// columns they have in common, a blank matching a blank; the left's columns, then the right's
// others. The outer join keeps a left row that matches none, the right's columns blank.
function naturalJoin(outer) {
  return (c, args, env) => {
    const what = outer ? 'NATURALLEFTOUTERJOIN' : 'NATURALINNERJOIN';
    const left = c.table(args[0], env), right = c.table(args[1], env);
    const on = joinColumns(left, right, what);
    const rest = right.cols.map((_, j) => j).filter(j => !on.some(p => p[1] === j));
    return { k: 'join', left, right, on, rest, outer, cols: [...left.cols, ...rest.map(j => right.cols[j])], base: null };
  };
}

// SUBSTITUTEWITHINDEX(table, "name", indexTable, order...): the rows of table that match a
// row of indexTable on their common columns (as NATURALINNERJOIN matches them), those columns
// replaced, at the end, by the matching row's place in indexTable's order (ASC unless it
// says), from 0. Ties in the order are broken by indexTable's columns.
function substituteWithIndex(c, args, env) {
  const src = c.table(args[0], env);
  if (args[1]?.k !== 'str') throw semantic('SUBSTITUTEWITHINDEX(table, "name", indexTable, expression, [order], ...)');
  const idx = c.table(args[2], env), row = ir.rowOf(idx);
  const order = orderBy(c, args, 3, c.iter(env, row), false);
  const on = joinColumns(src, idx, 'SUBSTITUTEWITHINDEX');
  const rest = src.cols.map((_, i) => i).filter(i => !on.some(p => p[0] === i));
  return { k: 'subindex', src, idx, row, on, rest, order, cols: [...rest.map(i => src.cols[i]), { name: args[1].v, lineage: null, t: 'int' }], base: null };
}

// ADDMISSINGITEMS(showAll columns..., table, groupBy columns..., filter tables...): the rows
// of the table (a SUMMARIZECOLUMNS'), and a row for each combination of the showAll columns'
// values that no row of it has, its other columns blank. The values are those the filter
// context and the filter tables leave the columns, with the blank row: within one table the
// combinations it holds, across tables every one.
function addMissingItems(c, args, env) {
  let i = 0;
  const show = [];
  for (; i < args.length && args[i].k === 'col'; i++) show.push(c.modelColumn(args[i], env));
  if (i >= args.length) throw semantic('ADDMISSINGITEMS(showAll columns, table, groupBy columns)');
  const src = c.table(args[i++], env);
  const t = src.k === 'scan' || src.k === 'shared' ? src : { k: 'shared', src, cols: src.cols, base: src.base };
  const groupBy = [];
  for (; i < args.length; i++) {
    const a = args[i];
    if (a.k === 'call' && (a.fn === 'ROLLUPADDISSUBTOTAL' || a.fn === 'ROLLUPGROUP' || a.fn === 'ROLLUPISSUBTOTAL')) throw unsupported(`${a.fn} in ADDMISSINGITEMS`);
    if (a.k !== 'col') break;
    groupBy.push(c.modelColumn(a, env));
  }
  const ctx = i < args.length ? c.calculateCtx(args.slice(i), { ...env, rows: [] }) : env.ctx;
  if (!show.length) return t;
  const pos = show.map(col => {
    const p = t.cols.findIndex(x => x.lineage === col);
    if (p < 0 || !groupBy.includes(col)) throw semantic(`ADDMISSINGITEMS: '${col.table.name}'[${col.name}] is not a column the table groups by`);
    return p;
  });
  // The combinations: each table's, crossed.
  const byTable = new Map();
  for (const col of show) {
    if (!byTable.has(col.table)) byTable.set(col.table, []);
    byTable.get(col.table).push(col);
  }
  const parts = [...byTable].map(([tb, cols]) => ir.values(tb, ctx, cols, (x, y) => c.scan(x, y), blankOf(c, tb, 'VALUES')));
  const combos = parts.length === 1 ? parts[0] : { k: 'cross', srcs: parts, cols: parts.flatMap(p => p.cols), base: null };
  const at = show.map(col => [...byTable.values()].flat().indexOf(col));
  // Those no row of the table has.
  const crow = ir.rowOf(combos, 'table'), trow = ir.rowOf(t);
  const has = { k: 'insub', e: at.map(k => ir.col(crow, k)), src: ir.project(t, trow, pos.map(p => ir.itemOf(trow, keyRef(trow, t, p)))), t: 'bool', nn: true };
  const missing = ir.filter(combos, crow, ir.op('not', has));
  const mrow = ir.rowOf(missing, 'table');
  const added = ir.project(missing, mrow, t.cols.map((col, p) => {
    const k = pos.indexOf(p);
    return { name: col.name, expr: k >= 0 ? ir.col(mrow, at[k]) : ir.lit(null, col.t), lineage: col.lineage, t: col.t };
  }));
  return { k: 'union', srcs: [t, added], cols: t.cols, base: null };
}

function crossJoin(c, args, env) {
  const srcs = args.map(a => c.table(a, env));
  // Rows of one value each: one row of all of them; before other tables, a prefix of theirs.
  const ones = srcs.findIndex(s => !(s.k === 'onerow' && s.cols.every(x => x.lineage)));
  const head = ones < 0 ? srcs : srcs.slice(0, ones), rest = ones < 0 ? [] : srcs.slice(ones);
  if (head.length) {
    const vals = head.flatMap(s => s.vals), lineages = head.flatMap(s => s.cols.map(x => x.lineage));
    const cond = head.map(s => s.cond).reduce((a, b) => ir.op('and', a, b));
    if (!rest.length) return ir.oneRow(vals, cond, lineages);
    const tail = rest.length === 1 ? rest[0] : { k: 'cross', srcs: rest, cols: rest.flatMap(s => s.cols), base: null };
    return ir.prefix(vals, cond, lineages, tail);
  }
  return { k: 'cross', srcs, cols: srcs.flatMap(s => s.cols), base: null };
}

function setOp(k) {
  return (c, args, env) => {
    const srcs = args.map(a => c.table(a, env));
    const n = srcs[0].cols.length;
    // One value EXCEPT (or INTERSECT) a column: that value, if it is not (is) in the column.
    if (k !== 'union' && srcs[0].k === 'onerow' && srcs.slice(1).every(s => s.cols.length === n)) {
      let cond = srcs[0].cond;
      for (const s of srcs.slice(1)) {
        const hit = { k: 'insub', e: srcs[0].vals, src: s, t: 'bool', nn: true };
        cond = ir.op('and', cond, k === 'except' ? ir.op('not', hit) : hit);
      }
      return { ...srcs[0], cond };
    }
    // Values before a table, EXCEPT (or INTERSECT) a table: the rows of the table that, after
    // the values, are not (are) in it.
    if (k !== 'union' && srcs[0].k === 'prefix' && srcs.slice(1).every(s => s.cols.length === n)) {
      const p = srcs[0];
      let src = p.src;
      for (const s of srcs.slice(1)) {
        const row = ir.rowOf(src, 'table');
        const hit = { k: 'insub', e: [...p.vals, ...src.cols.map((_, i) => ir.col(row, i))], src: s, t: 'bool', nn: true };
        src = ir.filter(src, row, k === 'except' ? ir.op('not', hit) : hit);
      }
      return { ...p, src };
    }
    if (srcs.some(s => s.cols.length !== n)) throw semantic(`${k.toUpperCase()}: the tables have different numbers of columns`);
    // UNION keeps a column's lineage when every table agrees on it; the others the first's.
    const cols = srcs[0].cols.map((col, i) => ({ ...col,
      lineage: k !== 'union' || srcs.every(s => s.cols[i].lineage === col.lineage) ? col.lineage : null }));
    return { k, srcs, cols, base: k === 'union' ? null : srcs[0].base };
  };
}

function generate(outer) {
  return (c, args, env) => {
    const left = c.table(args[0], env), lrow = ir.rowOf(left);
    const right = c.table(args[1], c.iter(env, lrow));
    return { k: 'generate', left, lrow, right, outer, cols: [...left.cols, ...right.cols], base: null };
  };
}

function rowFn(c, args, env) {
  const p = pairs(args, 0, 'ROW');
  return rowsTable(p.map(x => x[0]), [p.map(x => c.scalar(x[1], env))]);
}

function dataTable(c, args, env) {
  const data = args.at(-1);
  if (data?.k !== 'table') throw semantic('DATATABLE ends with the rows, { { ... } }');
  const names = [];
  for (let i = 0; i + 1 < args.length - 1; i += 2) names.push(args[i].v);
  // { { 1, "a" }, { 2, "b" } }: each inner { } is a row.
  const rows = data.rows.map(r => {
    const cells = r.length === 1 && r[0].k === 'table' ? r[0].rows.map(x => x[0]) : r;
    return cells.map(x => c.scalar(x, env));
  });
  return rowsTable(names, rows);
}

function series(c, args, env) {
  const start = c.scalar(args[0], env), end = c.scalar(args[1], env), step = args[2] ? c.scalar(args[2], env) : ir.lit(1);
  const t = [start, end, step].every(x => x.t === 'int') ? 'int' : 'double';
  return { k: 'series', start, end, step, cols: [{ name: 'Value', lineage: null, t }], base: null };
}
function calendar(c, args, env) {
  const start = c.scalar(args[0], env), end = c.scalar(args[1], env);
  return { k: 'series', start, end, step: ir.lit(1), cols: [{ name: 'Date', lineage: null, t: 'datetime' }], base: null };
}

function treatAs(c, args, env) {
  const t = c.table(args[0], env);
  const cols = args.slice(1).map(a => c.modelColumn(a, env));
  if (cols.length !== t.cols.length) throw semantic(`TREATAS: the table has ${t.cols.length} column(s) and ${cols.length} are named`);
  return { ...t, cols: t.cols.map((x, i) => ({ ...x, lineage: cols[i] })), base: null };
}

function keepFiltersTable(c, args, env) { return c.table(args[0], env); }

function filters(c, args, env) { return filtersTable(c, c.modelColumn(args[0], env), env); }

// FIRSTNONBLANK(T[c], expr): the first value of the column for which expr is not blank. The
// column is its values in the filter context; a table of one column (FILTER(ALL(T[c]), ...))
// is those values, the column its lineage.
function nonBlank(fn) {
  return (c, args, env) => {
    let col, src;
    if (args[0].k === 'col') {
      col = c.modelColumn(args[0], env);
      src = ir.values(col.table, env.ctx, [col], (tb, ctx) => c.scan(tb, ctx));
    } else {
      src = c.table(args[0], env);
      col = src.cols.length === 1 ? src.cols[0].lineage : null;
      if (!col) throw semantic(`${fn === 'min' ? 'FIRSTNONBLANK' : 'LASTNONBLANK'} takes a column, or a table of one column of the model`);
    }
    const row = ir.rowOf(src, 'table');
    const e = c.scalar(args[1], c.iter(env, row));
    const kept = ir.filter(src, row, ir.op('not', ir.fn('isblank', [e], 'bool', { nn: true })));
    const krow = ir.rowOf(kept, 'table');
    const v = ir.agg(fn, kept, krow, ir.col(krow, 0), col.type);
    return { k: 'rows', rows: [[v]], cols: [{ name: col.name, lineage: col, t: col.type }], base: null, nonEmpty: true };
  };
}

// --- SUMMARIZECOLUMNS -------------------------------------------------------------------
// The groups: the combinations of the grouping columns' values the filters keep (within one
// table, the combinations it holds; across tables, all of them), and each expression
// evaluated with the group's values as filters. A group whose expressions are all blank is
// left out. With ROLLUPADDISSUBTOTAL, each level of subtotals is the same with fewer keys.
// Each ROLLUPADDISSUBTOTAL is an axis of its own (a matrix's rows, its columns): within one,
// the levels drop its columns from the last; across several, every level of one goes with
// every level of the others (a row total by each column, a column total by each row, the
// corner).
function summarizeColumns(c, args, env) {
  const plain = [], rolls = [], axes = [], keyCols = [];
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i];
    if (a.k === 'col' && a.table && c.model.findColumn(a.table, a.name)) { const k = c.modelColumn(a, env); plain.push(k); keyCols.push(k); continue; }
    if (a.k === 'call' && a.fn === 'ROLLUPADDISSUBTOTAL') {
      const r = rollup(c, a.args, env);
      axes.push(r.map((_, n) => rolls.length + n));
      rolls.push(...r);
      keyCols.push(...r.flatMap(x => x.cols));
      continue;
    }
    if (a.k === 'call' && a.fn === 'ROLLUPGROUP') { const ks = a.args.map(x => c.modelColumn(x, env)); plain.push(...ks); keyCols.push(...ks); continue; }
    break;
  }
  const filterArgs = [];
  for (; i < args.length && args[i].k !== 'str'; i++) filterArgs.push(args[i]);
  const exprs = pairs(args, i, 'SUMMARIZECOLUMNS');
  const given = filterArgs.length ? c.calculateCtx(filterArgs, { ...env, rows: [] }, true) : null;
  const ctx0 = given ? autoExist(c, given, env.ctx, []) : env.ctx;
  const selected = given ?? env.ctx;
  // Its groups are a shadow filter context on the columns it groups by: their values under
  // its filters on those columns. A filter on another column narrows the groups (auto-exist)
  // but not the shadow: ALLSELECTED(Product[Product]) is every product under a filter on
  // Product[Category]. Those marked NONVISUAL filter the groups and the expressions, but are
  // not part of that shadow: it covers their columns too, with the values the other filters
  // leave them, so ALLSELECTED takes them off.
  const nonvisual = ctx0.filters.filter(f => f.nonvisual);
  const shadowCols = new Set([...keyCols, ...nonvisual.flatMap(f => f.cols)]);
  const shadow = { cols: shadowCols, src: null,
    ctx: new Ctx(selected.filters.filter(f => !f.nonvisual), selected.mods).remove(x => !shadowCols.has(x)) };
  if (new Set(keyCols).size !== keyCols.length) throw semantic('SUMMARIZECOLUMNS groups by the same column twice');
  const keyRow = ir.newRow(keyCols.map(k => ({ name: k.name, lineage: k, t: k.type })), 'key');
  // The levels: how many of each axis' columns stay, the detail first.
  let depths = [[]];
  for (const ax of axes) depths = depths.flatMap(d => Array.from({ length: ax.length + 1 }, (_, n) => [...d, ax.length - n]));
  const levels = [];
  for (const depth of depths) {
    const kept = axes.flatMap((ax, n) => ax.slice(0, depth[n]));
    const on = new Set([...plain, ...kept.flatMap(r => rolls[r].cols)]);
    const active = keyCols.filter(k => on.has(k));
    // Each level's own keys join its filters' combinations (a subtotal's, without the keys it drops).
    let ctx = given && active.length ? autoExist(c, given, env.ctx, active) : ctx0;
    for (const k of active) ctx = ctx.add({ kind: 'bind', cols: [k], val: ir.col(keyRow, keyCols.indexOf(k)) });
    const shadows = shadow.cols.size ? [...env.shadows, shadow] : env.shadows;
    const inner = { ...env, ctx, rows: [], grouped: new Set(active), shadows };
    const items = exprs.map(([name, x]) => {
      const ignore = x.k === 'call' && (x.fn === 'IGNORE' || x.fn === 'NONVISUAL') ;
      const expr = c.scalar(ignore ? x.args[0] : x, inner);
      return { name, expr, t: expr.t, ignore: x.k === 'call' && x.fn === 'IGNORE' };
    });
    levels.push({ active, flags: rolls.map((_, n) => !kept.includes(n)), items });
  }
  const cols = [...keyCols.map(k => ({ name: k.name, lineage: k, t: k.type })),
    ...rolls.map(r => ({ name: r.flag, lineage: null, t: 'bool' })),
    ...exprs.map(([name], n) => ({ name, lineage: null, t: levels[0].items[n].t }))];
  return { k: 'sc', keyRow, keyCols, rolls, levels, ctx0, cols, base: null };
}

// Auto-exist: the filters SUMMARIZECOLUMNS' arguments put on the columns of one table are
// one filter, the combinations of those columns the table holds under all of them. Removing
// one column's filter later (REMOVEFILTERS in a measure) leaves the others' columns to the
// values those combinations have: T[a] = "x" and T[b] IN {1, 2}, without the filter on a,
// is the values among 1 and 2 that b has in a row where a is "x". The columns it groups by
// on that table (keys) are part of the combinations, and each group binds its own values: so
// removing one filter leaves the others to the values they have with that group's key, not
// with any group's.
function autoExist(c, ctx, outer, keys) {
  const byTable = new Map();
  for (const f of ctx.filters) {
    if (outer.filters.includes(f) || (f.kind === 'rel' && f.base) || f.nonvisual) continue;
    const t = f.cols[0].table;
    if (f.cols.some(x => x.table !== t)) continue;
    if (!byTable.has(t)) byTable.set(t, []);
    byTable.get(t).push(f);
  }
  for (const [t, fs] of byTable) {
    if (fs.length < 2) continue;
    const cols = [...new Set([...fs.flatMap(f => f.cols), ...keys.filter(k => k.table === t)])];
    const src = ir.values(t, new Ctx(fs, ctx.mods), cols, (tb, x) => c.scan(tb, x), c.blankRowRels(t).length > 0);
    ctx = new Ctx(ctx.filters.filter(f => !fs.includes(f)), ctx.mods).add({ kind: 'rel', cols, src, idx: cols.map((_, i) => i), base: null });
  }
  return ctx;
}

// ROLLUPADDISSUBTOTAL(col | ROLLUPGROUP(cols), "flag", ...) -> [{ cols, flag }].
function rollup(c, args, env) {
  const out = [];
  for (let i = 0; i < args.length;) {
    const a = args[i];
    let cols;
    if (a.k === 'call' && a.fn === 'ROLLUPGROUP') cols = a.args.map(x => c.modelColumn(x, env));
    else if (a.k === 'col') cols = [c.modelColumn(a, env)];
    else throw unsupported('ROLLUPADDISSUBTOTAL with a filter');
    if (args[i + 1]?.k !== 'str') throw semantic('ROLLUPADDISSUBTOTAL(column, "name", ...)');
    out.push({ cols, flag: args[i + 1].v });
    i += 2;
    // A group-level filter table after the name is not supported.
    if (i < args.length && args[i].k !== 'col' && !(args[i].k === 'call' && args[i].fn === 'ROLLUPGROUP'))
      throw unsupported('ROLLUPADDISSUBTOTAL with a filter');
  }
  return out;
}

// --- modifiers --------------------------------------------------------------------------

// ALL(...) and REMOVEFILTERS(...) as filter arguments: remove filters.
function removeMod(c, args, env) {
  if (!args.length || args.every(a => a.k === 'empty')) return { kind: 'remove', all: true };
  const tables = [], cols = new Set();
  for (const a of args) {
    if (isModelTableName(c, a, env)) tables.push(c.model.table(a.name));
    else cols.add(c.modelColumn(a, env));
  }
  return { kind: 'remove', drop: ctx => {
    const hit = new Set(cols);
    for (const t of tables) for (const x of c.expandedColumns(t, ctx)) hit.add(x);
    return x => hit.has(x);
  } };
}
function allExceptMod(c, args, env) {
  if (!isModelTableName(c, args[0], env)) throw semantic('ALLEXCEPT(table, column, ...)');
  const t = c.model.table(args[0].name), keep = new Set(args.slice(1).map(a => c.modelColumn(a, env)));
  return { kind: 'remove', drop: ctx => { const exp = c.expandedColumns(t, ctx); return x => exp.has(x) && !keep.has(x); } };
}
function allSelectedMod(c, args, env) {
  if (!args.length) return { kind: 'selected', cols: null, clear: false };
  const tables = args.every(a => isModelTableName(c, a, env));
  const cols = new Set(args.flatMap(a => isModelTableName(c, a, env) ? [...c.expandedColumns(c.model.table(a.name), env.ctx)] : [c.modelColumn(a, env)]));
  // Columns no shadow covers: a table's keep their filters, named columns lose them.
  return { kind: 'selected', cols, clear: !tables };
}
function useRelationship(c, args, env) {
  const a = c.modelColumn(args[0], env), b = c.modelColumn(args[1], env);
  const rel = c.model.relationshipOf(a, b);
  if (!rel) throw semantic(`USERELATIONSHIP: no relationship between '${a.table.name}'[${a.name}] and '${b.table.name}'[${b.name}]`);
  return { kind: 'mods', change: mods => {
    for (const r of c.model.relationships) {
      const sameTables = new Set([r.from.table, r.to.table]);
      if (r !== rel && sameTables.has(rel.from.table) && sameTables.has(rel.to.table)) mods.active.set(r.name, false);
    }
    mods.active.set(rel.name, true);
  } };
}
function crossFilter(c, args, env) {
  const a = c.modelColumn(args[0], env), b = c.modelColumn(args[1], env);
  const rel = c.model.relationshipOf(a, b);
  if (!rel) throw semantic(`CROSSFILTER: no relationship between '${a.table.name}'[${a.name}] and '${b.table.name}'[${b.name}]`);
  const d = args[2]?.k === 'name' ? args[2].name.toUpperCase() : (args[2]?.k === 'num' ? ['NONE', 'ONEWAY', 'BOTH'][Number(args[2].v)] : null);
  // Left is the first column: LeftFiltersRight is the usual way when it is the one side.
  const leftIsOne = rel.to === a;
  const cross = { NONE: 'none', BOTH: 'both', ONEWAY: 'single',
    ONEWAY_LEFTFILTERSRIGHT: leftIsOne ? 'single' : 'reverse', ONEWAY_RIGHTFILTERSLEFT: leftIsOne ? 'reverse' : 'single' }[d];
  if (!cross) throw semantic('CROSSFILTER(column, column, None | OneWay | Both | OneWay_LeftFiltersRight | OneWay_RightFiltersLeft)');
  return { kind: 'mods', change: mods => mods.cross.set(rel.name, cross) };
}

export const table = {
  ALL: all, ALLNOBLANKROW: all, ALLEXCEPT: allExcept, ALLSELECTED: allSelected, ALLCROSSFILTERED: all,
  VALUES: valuesFn, DISTINCT: valuesFn, CALCULATETABLE: calculateTable, RELATEDTABLE: relatedTable,
  FILTER: filterFn, ADDCOLUMNS: addColumns, SELECTCOLUMNS: selectColumns, SUMMARIZE: summarize, GROUPBY: groupBy,
  CURRENTGROUP: currentGroup, SUMMARIZECOLUMNS: summarizeColumns, TOPN: topN, CROSSJOIN: crossJoin,
  UNION: setOp('union'), INTERSECT: setOp('intersect'), EXCEPT: setOp('except'),
  GENERATE: generate(false), GENERATEALL: generate(true), ROW: rowFn, DATATABLE: dataTable,
  GENERATESERIES: series, CALENDAR: calendar, TREATAS: treatAs, KEEPFILTERS: keepFiltersTable, FILTERS: filters,
  FIRSTNONBLANK: nonBlank('min'), LASTNONBLANK: nonBlank('max'),
  TOPNSKIP: topNSkip, NATURALINNERJOIN: naturalJoin(false), NATURALLEFTOUTERJOIN: naturalJoin(true),
  SUBSTITUTEWITHINDEX: substituteWithIndex, ADDMISSINGITEMS: addMissingItems,
};

export const modifiers = {
  ALL: removeMod, ALLNOBLANKROW: removeMod, REMOVEFILTERS: removeMod, ALLCROSSFILTERED: removeMod,
  ALLEXCEPT: allExceptMod, ALLSELECTED: allSelectedMod,
  USERELATIONSHIP: useRelationship, CROSSFILTER: crossFilter,
};
