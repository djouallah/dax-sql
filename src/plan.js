// The relational plan: what an engine has to do for a query, as relational algebra, knowing
// nothing of any engine. lower.js builds it from the intermediate form (ir.js), plan-sql.js
// writes it as one dialect's SQL, explain.js draws it.
//
// Every column of every relation has an id of its own, unique in the query: a column is named
// by its id wherever it is read, so a correlated reference (a column of an outer relation read
// inside an apply or an EXISTS) is just that id.
//   col      { id, name, t, nn, lineage, table }   lineage: the model column it holds; table:
//                                                   the model table it was scanned from
// Only operators any engine can run: no SQL in the plan; each printer spells them. Scalars:
// lit, op, fn, case (DAX's operators and functions, with DAX's rules for blanks), and
//   ref      { col }                     a column
//   exists   { rel }                     whether rel has a row (none correlated, optimized)
//   pop      { op, a }                   the plan's own operators, NULL as SQL has it: eq (=,
//                                        NULL matches nothing), key (≡, a blank matches a blank:
//                                        a join's key), isnull, notnull, lt, le, gt, ge, add,
//                                        sub, coalesce, true, false
// Relations (all carry `cols`):
//   scan      { table }                   a model table's stored rows
//   values    { rows: [[scalar]] }        rows of constants (oneRow: the one row a FROM-less SELECT has)
//   select    { src, pred }               σ
//   project   { src, items: [{ col, expr }] }   π
//   distinct  { src }                     δ
//   aggregate { src, keys: [{ col, expr }], aggs: [{ col, fn, arg, extra }] }   γ (no keys: one row)
//   join      { kind: inner|left|cross, left, right, on }
//   apply     { outer, left, right }      right evaluated for each row of left (outer: a row of
//                                        left with none of right kept, right's columns blank)
//   union     { srcs, picks }             all rows of each, its columns picks[i] of the i-th
//   window    { src, part: [scalar], fns: [{ col, fn, order: [term] }] }   ω: row_number, rank,
//                                        dense_rank, count of the partition
//   series    { src, start, end, step }   GENERATESERIES's rows; bounds that are not constants
//                                        are columns of src, a relation of one row
//   shared    { def }                     the rows of a definition the query names once and
//                                        reads at each use (a table VAR, a calculated table):
//                                        evaluated once, as DAX does, under columns of its own
//   output    { src, items: [{ name, expr, cast }], order: [{ expr, desc }], limit, defs }
//                                        the result; defs: the definitions, in order
// An order term: { expr, desc, mode: 'dax' (a blank first ascending), 'term' (DAX's ORDER BY
// rules, with `blanks` and `t`), 'plain' (ascending, NULLs first) }.

let nextId = 1;
export const newCol = (name, t, { nn = false, lineage = null, table = null } = {}) => ({ id: nextId++, name, t, nn, lineage, table });
export const ref = col => ({ k: 'ref', col, t: col.t, nn: col.nn });
export const exists = rel => ({ k: 'exists', rel, t: 'bool', nn: true });
const pop = (op, a, t = 'bool', nn = true) => ({ k: 'pop', op, a, t, nn });
// Conditions that compare (op: lt, le, gt, ge).
export const cmp = (op, l, r) => pop(op, [l, r]);
export const add = (l, r) => pop('add', [l, r], 'int', false);
export const sub = (l, r) => pop('sub', [l, r], 'int', false);
export const coalesce = (x, v) => pop('coalesce', [x, v], x.t ?? v.t, true);
export const TRUE = pop('true', []), FALSE = pop('false', []);
// Whether a plan operator is a condition (the others are values).
export const isCondOp = op => !['add', 'sub', 'mul', 'div', 'neg', 'coalesce', 'nullif', 'cast', 'concat', 'call'].includes(op);

// Conditions, as SQL has them.
export const and = xs => xs.length === 1 ? xs[0] : xs.reduce((l, r) => pop('and', [l, r]));
export const or = xs => xs.length === 1 ? xs[0] : xs.reduce((l, r) => pop('or', [l, r]));
export const not = x => pop('not', [x]);
// ≡: a blank matching a blank (DAX's ==, SQL's IS NOT DISTINCT FROM).
export const same = (l, r) => ({ k: 'op', op: 'eqs', a: [l, r], t: 'bool', nn: true });
// =: NULL matching nothing (a relationship's join).
export const eq = (l, r) => pop('eq', [l, r]);
// ≡ as a join's key (a printer writes it as its engine hashes it: PostgreSQL's arrays).
export const key = (l, r) => pop('key', [l, r]);
export const notNull = x => pop('notnull', [x]);
export const isNull = x => pop('isnull', [x]);

// --- relations ---------------------------------------------------------------------------

const copy = (cols, src = cols) => cols.map((c, i) => newCol(c.name, c.t, { nn: c.nn, lineage: src[i]?.lineage ?? null, table: src[i]?.table ?? null }));

export const scan = table => ({ k: 'scan', table,
  cols: table.columns.filter(c => !c.expr).map(c => newCol(c.name, c.type, { lineage: c, table })) });
export function values(rows, cols) { return { k: 'values', rows, cols }; }
export const oneRow = () => values([[{ k: 'lit', v: 1, t: 'int', nn: true }]], [newCol('one', 'int', { nn: true })]);
export const select = (src, pred) => ({ k: 'select', src, pred, cols: src.cols });
export function project(src, items) {
  return projectAs(src, items.map(i => ({ col: newCol(i.name, i.t ?? i.expr.t, { nn: !!i.expr.nn, lineage: i.lineage ?? null, table: i.table ?? null }), expr: i.expr })));
}
// A projection onto columns given: [{ col, expr }] (a rewrite keeps the columns it replaces).
export const projectAs = (src, items) => ({ k: 'project', src, items, cols: items.map(i => i.col) });
export const distinct = src => ({ k: 'distinct', src, cols: src.cols });
export function aggregate(src, keys, aggs) {
  const ks = keys.map(k => ({ col: k.col ?? newCol(k.name, k.expr.t, { lineage: k.lineage ?? null }), expr: k.expr }));
  const as = aggs.map(a => ({ ...a, col: a.col ?? newCol(a.name ?? 'v', a.t) }));
  return { k: 'aggregate', src, keys: ks, aggs: as, cols: [...ks.map(k => k.col), ...as.map(a => a.col)] };
}
export const join = (kind, left, right, on = null) => ({ k: 'join', kind, left, right, on, cols: [...left.cols, ...right.cols] });
export const apply = (left, right, outer = false) => ({ k: 'apply', outer, left, right, cols: [...left.cols, ...right.cols] });
// UNION ALL of relations of the same columns (as positions), under columns of its own.
// picks: the columns of each branch it reads, in order (a rewrite can give a branch more).
export const union = (srcs, cols = copy(srcs[0].cols)) => ({ k: 'union', srcs, picks: srcs.map(s => s.cols.slice(0, cols.length)), cols });
// Each function with its own order: [{ name, fn, order }].
export function window(src, part, fns) {
  const fs = fns.map(f => ({ ...f, col: f.col ?? newCol(f.name, 'int', { nn: true }) }));
  return { k: 'window', src, part, fns: fs, cols: [...src.cols, ...fs.map(f => f.col)] };
}
export const series = (start, end, step, t, name, src = null) => ({ k: 'series', src, start, end, step, t, cols: [newCol(name, t)] });
export const output = (src, items, order, defs = []) => ({ k: 'output', src, items, order, limit: null, defs, cols: [] });
// A definition (its relation, its number), and a use of it.
export const definition = (rel, n) => ({ rel, n });
export const shared = def => ({ k: 'shared', def, picks: def.rel.cols.slice(), cols: copy(def.rel.cols) });
