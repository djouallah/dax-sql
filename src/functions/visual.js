// Visual calculations: a DEFINE TABLE WITH VISUAL SHAPE and the DEFINE COLUMNs on it.
//
// The table is its rows and, with DENSIFY, the cells its axes cross that it lacks (the DENSIFY
// column TRUE on those, their other columns blank); each column is then added in turn, over the
// rows so far, and comes first: the columns, then the table's. In a column:
//   - a row's level on an axis is its TOTAL columns; its depth, the groups of the axis it is not
//     a total of;
//   - RANK, ROWNUMBER, INDEX, OFFSET and WINDOW with no relation are over the visual's rows on
//     one axis (ROWS, COLUMNS; the first when it says none): those in the row's place on the
//     other axes and at its level, in the axis's ORDER BY when they have no ORDERBY; a reset
//     narrows them to the rows under one parent: HIGHESTPARENT (1) or N, the first N groups';
//     LOWESTPARENT (-1) or -N, the groups to N above the row's depth; NONE (0), none;
//   - RUNNINGSUM, MOVINGAVERAGE, PREVIOUS, NEXT, FIRST and LAST are WINDOW, OFFSET and INDEX
//     over those rows;
//   - COLLAPSE is the value at the parent row (a total of the row's lowest group), COLLAPSEALL
//     at the axis's grand total; ISATLEVEL, whether the row is not a total of a column's group.
import * as ir from '../ir.js';
import { semantic, unsupported } from '../errors.js';

const lc = s => String(s).toLowerCase();
const word = (a, set) => a?.k === 'name' && set.includes(a.name.toUpperCase());
const name = n => ({ k: 'name', name: n });
const col = n => ({ k: 'col', table: null, name: n });
const str = v => ({ k: 'str', v });
const num = v => ({ k: 'num', v: String(v) });
const bool = v => ({ k: 'bool', v });
const call = (fn, ...args) => ({ k: 'call', fn, args });
const bin = (op, l, r) => ({ k: 'bin', op, l, r });
const columns = (src, names, more = []) => call('SELECTCOLUMNS', src, ...names.flatMap(n => [str(n), col(n)]), ...more);
const axisCols = a => a.groups.flatMap(g => [...g.cols, ...(g.total ? [g.total] : [])]);

// The table: an expression of the compiler's, for the table WITH VISUAL SHAPE `ast`.
export function visualTable(c, ast, env) {
  const v = i => ` visual ${i}`;
  let e = c.withVars([{ name: v('in'), e: ast.input }], env);
  const input = c.table(name(v('in')), e), names = input.cols.map(x => x.name);
  const { axes, densify } = ast.shape;
  for (const n of axes.flatMap(axisCols)) if (!names.some(x => lc(x) === lc(n))) throw semantic(`WITH VISUAL SHAPE: the table has no column [${n}]`);
  let base = name(v('in'));
  if (densify) {
    const flagged = (src, val) => call('ADDCOLUMNS', src, str(densify), bool(val));
    base = flagged(base, false);
    if (axes.length > 1) {
      const place = new Set(axes.flatMap(axisCols).map(lc));
      const crossed = call('CROSSJOIN', ...axes.map(a => call('DISTINCT', columns(name(v('in')), axisCols(a)))));
      const missing = call('EXCEPT', crossed, columns(name(v('in')), axes.flatMap(axisCols)));
      const cells = call('SELECTCOLUMNS', missing, ...names.flatMap(n => [str(n), place.has(lc(n)) ? col(n) : call('BLANK')]), str(densify), bool(true));
      base = call('UNION', base, cells);
    }
  }
  const defs = [{ name: v(0), e: base }];
  ast.columns.forEach((d, i) => defs.push({ name: v(i + 1),
    e: call('ADDCOLUMNS', name(v(i)), str(d.name), { k: 'visual', e: d.e, rel: name(v(i)), axes }) }));
  e = c.withVars(defs, e);
  const t = c.table(name(v(ast.columns.length)), e), row = ir.rowOf(t, 'table'), n = ast.columns.length;
  const at = [...t.cols.keys()], order = [...at.slice(at.length - n), ...at.slice(0, at.length - n)];
  return ir.project(t, row, order.map(i => ({ name: t.cols[i].name, lineage: t.cols[i].lineage, expr: ir.col(row, i) })));
}

// The axis a window function's argument names (null: the first), in visual calculation `vis`.
function axisOf(vis, axisName) {
  const a = axisName ? vis.axes.find(x => lc(x.name) === lc(axisName)) : vis.axes[0];
  if (!a) throw semantic(`the visual has no axis ${axisName}`);
  return a;
}
// A reset: HIGHESTPARENT, LOWESTPARENT, NONE or an integer, as N.
export const isReset = a => word(a, ['NONE', 'LOWESTPARENT', 'HIGHESTPARENT']) || a?.k === 'num' && /^\d+$/.test(a.v) || a?.k === 'neg' && a.e.k === 'num' && /^\d+$/.test(a.e.v);
const resetOf = a => {
  if (!a) return 0;
  if (a.k === 'name') return { NONE: 0, HIGHESTPARENT: 1, LOWESTPARENT: -1 }[a.name.toUpperCase()];
  return a.k === 'neg' ? -Number(a.e.v) : Number(a.v);
};

// For a window function with no relation in a visual calculation: the relation, its order when
// the function has no ORDERBY, and its partitions, as expressions on a row of it.
export function visualWindow(c, env, { axisName, resetAst }) {
  const vis = env.visual, axis = axisOf(vis, axisName);
  const rel = c.table(vis.rel, env), row = ir.rowOf(rel, 'table');
  const at = n => {
    const i = rel.cols.findIndex(x => lc(x.name) === lc(n));
    if (i < 0) throw semantic(`the visual has no column [${n}]`);
    return ir.col(row, i);
  };
  const parts = [];
  for (const a of vis.axes) if (a !== axis) parts.push(...axisCols(a).map(at));
  parts.push(...axis.groups.filter(g => g.total).map(g => at(g.total)));
  const reset = resetOf(resetAst), gs = axis.groups;
  if (reset > 0) parts.push(...gs.slice(0, reset).flatMap(g => g.cols.map(at)));
  else if (reset < 0) {
    gs.forEach((g, k) => {
      const below = gs[k - reset];
      if (!below) return;
      // Group k is a parent of the row when the group `-reset` below it is not a total.
      for (const n of g.cols) parts.push(below.total ? ir.kase([[ir.op('not', at(below.total)), at(n)]], null, at(n).t) : at(n));
    });
  }
  const order = axis.order.map(o => ({ ast: col(o.col), desc: o.desc, blanks: null }));
  return { rel, row, parts, order };
}

const only = (fn, env) => {
  if (!env.visual) throw semantic(`${fn} is only valid in a visual calculation`);
};
// The arguments after a function's own: an axis, blanks and a reset, for its window.
const rest = (fn, args) => {
  for (const a of args) if (a.k !== 'empty' && !word(a, ['ROWS', 'COLUMNS', 'DEFAULT', 'FIRST', 'LAST']) && !isReset(a))
    throw semantic(`${fn}: unexpected argument`);
  return args.filter(a => a.k !== 'empty');
};
// PREVIOUS and NEXT: their steps (1 when left out), and the arguments after them.
const stepped = r => (r[0] && r[0].k !== 'name' ? [r[0].k === 'empty' ? num(1) : r[0], r.slice(1)] : [num(1), r]);

function windowed(fn, make) {
  return (c, args, env) => {
    only(fn, env);
    return c.scalar(make(args), env);
  };
}

// The value of `expr` at the row of the visual whose place on the other axes is the row's, and
// whose level on `axis` is `parentFlag(k)` of each of its groups (a total, or not), holding the
// row's columns of the groups that are not totals there.
function atLevel(c, env, fn, expr, axis, parentFlag) {
  const vis = env.visual, defs = [], cur = n => { const v = ` cur ${defs.length}`; defs.push({ name: v, e: col(n) }); return name(v); };
  const conds = [];
  for (const a of vis.axes) if (a !== axis) for (const n of axisCols(a)) conds.push(bin('==', col(n), cur(n)));
  const flags = axis.groups.map(g => (g.total ? cur(g.total) : bool(false)));
  axis.groups.forEach((g, k) => {
    const pf = parentFlag(flags, k);
    if (g.total) conds.push(bin('==', col(g.total), pf));
    for (const n of g.cols) conds.push(bin('||', pf, bin('==', col(n), cur(n))));
  });
  const filter = call('FILTER', vis.rel, conds.reduce((l, r) => bin('&&', l, r)));
  return c.scalar({ k: 'var', defs, body: call('MAXX', filter, expr) }, env);
}

function collapse(all) {
  const fn = all ? 'COLLAPSEALL' : 'COLLAPSE';
  return (c, args, env) => {
    only(fn, env);
    const [expr, ...more] = args;
    if (more.length > 1 || more.some(a => !word(a, ['ROWS', 'COLUMNS']))) throw unsupported(`${fn} of more than one axis`);
    const axis = axisOf(env.visual, more[0]?.name);
    // The parent: a total of the row's lowest group, the groups above it as they are.
    return atLevel(c, env, fn, expr, axis, all ? () => bool(true)
      : (flags, k) => (k + 1 < flags.length ? bin('||', flags[k], flags[k + 1]) : bool(true)));
  };
}

function isAtLevel(c, args, env) {
  only('ISATLEVEL', env);
  const a = args[0];
  if (a?.k !== 'col') throw semantic('ISATLEVEL takes a column of the visual');
  for (const axis of env.visual.axes) for (const g of axis.groups)
    if (g.cols.some(n => lc(n) === lc(a.name))) return g.total ? c.scalar({ k: 'not', e: col(g.total) }, env) : ir.TRUE;
  throw semantic(`ISATLEVEL: [${a.name}] is not a column of the visual's axes`);
}

function expand(fn) {
  return (c, args, env) => {
    only(fn, env);
    if (args[0]?.k === 'col') throw semantic('Column reference cannot be used unless it is guaranteed to be unique in the context.');
    throw unsupported(fn);
  };
}

export const scalar = {
  RUNNINGSUM: windowed('RUNNINGSUM', ([e, ...r]) => call('SUMX', call('WINDOW', num(1), name('ABS'), num(0), name('REL'), ...rest('RUNNINGSUM', r)), e)),
  MOVINGAVERAGE: windowed('MOVINGAVERAGE', ([e, size, ...r]) => call('AVERAGEX', call('WINDOW', bin('-', num(1), size), name('REL'), num(0), name('REL'), ...rest('MOVINGAVERAGE', r)), e)),
  PREVIOUS: windowed('PREVIOUS', ([e, ...r]) => { const [s, more] = stepped(r); return call('MAXX', call('OFFSET', { k: 'neg', e: s }, ...rest('PREVIOUS', more)), e); }),
  NEXT: windowed('NEXT', ([e, ...r]) => { const [s, more] = stepped(r); return call('MAXX', call('OFFSET', s, ...rest('NEXT', more)), e); }),
  FIRST: windowed('FIRST', ([e, ...r]) => call('MAXX', call('INDEX', num(1), ...rest('FIRST', r)), e)),
  LAST: windowed('LAST', ([e, ...r]) => call('MAXX', call('INDEX', { k: 'neg', e: num(1) }, ...rest('LAST', r)), e)),
  COLLAPSE: collapse(false), COLLAPSEALL: collapse(true),
  EXPAND: expand('EXPAND'), EXPANDALL: expand('EXPANDALL'),
  ISATLEVEL: isAtLevel,
};
