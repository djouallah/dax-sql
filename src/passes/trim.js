// Text as Power BI loads it: without its trailing spaces ("Desk Fan " is "Desk Fan": its value, its
// length, the filters and the relationships on it). Only the columns the caller says hold them (the
// trailingSpaces option, index.js; trailingSpacesCheck writes the statement that finds them): each
// scan of their table becomes a projection of it with those columns trimmed. Run after the passes
// (they see the scan) and before the plan is written as Substrait (every dialect's SQL reads it).
import * as P from '../plan.js';

// The option as a test of a model column, memoized for one compilation.
export function paddedOf(options) {
  const f = options?.trailingSpaces;
  if (typeof f !== 'function') return null;
  const memo = new Map();
  return c => {
    if (!c || c.type !== 'string' || c.expr) return false;
    const k = `${c.table.name}|${c.name}`;
    if (!memo.has(k)) memo.set(k, f({ key: k, table: c.table.name, column: c.name }) === true);
    return memo.get(k);
  };
}

export function trimScans(plan, padded) {
  if (!padded) return plan;
  const seen = new Set();
  const walk = x => {
    if (!x || typeof x !== 'object' || seen.has(x)) return;
    seen.add(x);
    if (x.k === 'scan' && !x.trimmed && x.cols?.some(c => padded(c.lineage))) {
      // (Marked: a plan trimmed once, kept and written again, is not trimmed twice.)
      const src = { k: 'scan', trimmed: true, table: x.table, cols: x.cols.map(c => P.newCol(c.name, c.t, { nn: c.nn, lineage: c.lineage, table: c.table })) };
      seen.add(src);
      const items = x.cols.map((c, i) => ({
        col: c,
        expr: padded(c.lineage) ? { k: 'pop', op: 'call', name: 'rtrim', a: [P.ref(src.cols[i])], t: 'string', nn: !!c.nn } : P.ref(src.cols[i]),
      }));
      // In place: every reader of the scan reads the trimmed columns (the same column objects).
      delete x.table;
      Object.assign(x, { k: 'project', src, items });
      return;
    }
    for (const [k, v] of Object.entries(x)) if (k !== 'lineage' && k !== 'table' && k !== 'base') walk(v);
  };
  walk(plan);
  return plan;
}
