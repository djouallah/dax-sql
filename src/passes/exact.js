// Exact sums: a sum of floating-point values depends on the order it adds them in, which an
// engine that adds in parallel does not keep. Two sums of the same values compared (a customer's
// sales against each customer's, to count those selling as much or more) may then differ in their
// last digit, and a value fail to equal itself. A comparison whose two sides both read such sums
// has them added exactly (as decimals, the same in any order: an aggregate's extra.exact, which
// each dialect writes). One that compares a sum with a constant is left as it is.
import { kids, scalarsOf } from './decorrelate.js';

const COMPARE = new Set(['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'key']);
const FLOAT = new Set(['sum', 'avg']);

export function exact(root) {
  // What makes each column: an aggregate's, or the columns an expression or a pick reads.
  const made = new Map();
  const seen = new Set();
  const index = r => {
    if (seen.has(r)) return;
    seen.add(r);
    kids(r).forEach(index);
    switch (r.k) {
      case 'aggregate':
        r.aggs.forEach(a => made.set(a.col, { agg: a }));
        r.keys.forEach(k => made.set(k.col, { reads: refs(k.expr) }));
        break;
      case 'project': r.items.forEach(i => made.set(i.col, { reads: refs(i.expr) })); break;
      case 'shared': index(r.def.rel); r.cols.forEach((c, i) => made.set(c, { reads: [r.picks[i]] })); break;
      case 'union': r.cols.forEach((c, i) => made.set(c, { reads: r.picks.map(p => p[i]) })); break;
    }
  };
  for (const d of root.defs ?? []) index(d.rel);
  index(root.src);

  // The floating-point sums a value reads, through the columns it reads.
  const sums = (x, out = new Set(), at = new Set()) => {
    for (const c of refs(x)) {
      const stack = [c];
      while (stack.length) {
        const col = stack.pop();
        if (at.has(col)) continue;
        at.add(col);
        const m = made.get(col);
        if (!m) continue;
        if (m.agg) { if (FLOAT.has(m.agg.fn) && (m.agg.extra?.t ?? col.t) === 'double') out.add(m.agg); }
        else stack.push(...m.reads);
      }
    }
    return out;
  };
  const mark = x => walk(x, y => {
    if (y.k !== 'pop' || !COMPARE.has(y.op) || y.a.length !== 2) return;
    const a = sums(y.a[0]), b = sums(y.a[1]);
    if (!a.size || !b.size) return;
    for (const g of [...a, ...b]) g.extra = { ...g.extra, exact: true };
  });
  const done = new Set();
  const visit = r => {
    if (done.has(r)) return;
    done.add(r);
    kids(r).forEach(visit);
    if (r.k === 'shared') visit(r.def.rel);
    scalarsOf(r).forEach(mark);
  };
  for (const d of root.defs ?? []) visit(d.rel);
  visit(root.src);
  return root;
}

function walk(x, f) {
  if (!x || typeof x !== 'object') return;
  f(x);
  if (x.k === 'case') { x.w.forEach(([c, v]) => { walk(c, f); walk(v, f); }); walk(x.e, f); return; }
  if (Array.isArray(x.a)) x.a.forEach(y => walk(y, f));
}
function refs(x) {
  const out = [];
  walk(x, y => { if (y.k === 'ref') out.push(y.col); });
  return out;
}
