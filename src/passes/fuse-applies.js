// Fusion in the correlated plan: the measures of a SUMMARIZECOLUMNS (and of a row of an iterator)
// are a chain of applies, each a grouping of no key (one row) over the rows its filter keeps:
//
//   (L ×ᴬ γ_a(σ_p R)) ×ᴬ γ_b(σ_{p ∧ q} R')
//
// where R and R' are the same relation (the same operators over the same tables, up to their
// columns' ids) and the second filter holds the first's terms: one grouping computes both,
// L ×ᴬ γ_{a, b'}(σ_p R), each of the second's aggregates over the rows q keeps (b' its argument
// under CASE WHEN q, COUNT(*) a count of CASE WHEN q THEN 1) — for the aggregates that pass over a
// NULL, so the rows q drops count for none. Each aggregate keeps its column: what reads it reads
// the same column.
import * as P from '../plan.js';
import { mapKids, conjuncts } from './decorrelate.js';
import { canon, text, remap, remapExtra } from './fuse.js';

// Aggregates whose value over rows is their value over the rows whose argument is not NULL.
const SKIP_NULL = new Set(['sum', 'avg', 'min', 'max', 'count_values', 'count_distinct', 'string_agg', 'median', 'stdev_s', 'stdev_p', 'var_s', 'var_p', 'product']);

export function fuseApplies(root) {
  const F = r => {
    r = mapKids(r, F);
    if (r.k !== 'apply' || !oneRow(r.right)) return r;
    // The chain below r, nearest first: an earlier grouping r's may join.
    for (let a = r.left, path = []; a.k === 'apply' && oneRow(a.right); path.push(a), a = a.left) {
      const merged = merge(a.right, r.right);
      if (!merged) continue;
      // r's grouping reads none of the columns the applies between make (they are siblings).
      if (path.some(b => b.right.cols.some(c => reads(r.right, c)))) break;
      if (a.right.cols.some(c => reads(r.right, c))) continue;
      const into = { ...a, right: merged, cols: [...a.left.cols, ...merged.cols] };
      const rebuilt = path.reduceRight((below, b) => ({ ...b, left: below, cols: [...below.cols, ...b.right.cols] }), into);
      return rebuilt;
    }
    return r;
  };
  for (const d of root.defs ?? []) d.rel = F(d.rel);
  return { ...root, src: F(root.src) };
}

const oneRow = r => r.k === 'aggregate' && !r.keys.length && r.src.k === 'select';

// g's grouping with h's aggregates joined to it, or null: the same rows, h's filter g's and more.
function merge(g, h) {
  const a = canon(g.src.src), b = canon(h.src.src);
  if (a.key !== b.key) return null;
  const map = new Map(b.cols.map((c, i) => [c, a.cols[i]]));
  const gs = conjuncts(g.src.pred).map(c => text(c, a.ids)), hs = conjuncts(h.src.pred);
  const rest = [...gs];
  const more = [];
  for (const c of hs) {
    const i = rest.indexOf(text(c, b.ids));
    if (i >= 0) rest.splice(i, 1); else more.push(remap(c, map));
  }
  if (rest.length) return null;   // g's filter has a term h's has not
  const q = more.length ? P.and(more) : null;
  if (q && !h.aggs.every(x => SKIP_NULL.has(x.fn) || x.fn === 'count_star')) return null;
  const when = (v, t) => ({ k: 'case', w: [[q, v]], e: { k: 'lit', v: null, t }, t });
  const aggs = h.aggs.map(x => {
    if (!q) return { ...x, arg: x.arg && remap(x.arg, map), extra: remapExtra(x.extra, map) };
    if (x.fn === 'count_star') return { ...x, fn: 'count_values', arg: when({ k: 'lit', v: 1, t: 'int', nn: true }, 'int'), extra: { ...x.extra, t: 'int' } };
    return { ...x, arg: when(remap(x.arg, map), x.arg.t), extra: remapExtra(x.extra, map) };
  });
  return { ...g, aggs: [...g.aggs, ...aggs], cols: [...g.cols, ...aggs.map(x => x.col)] };
}

// Whether a relation reads column c (a column of the row around it).
function reads(r, c) {
  const seen = new Set();
  const inX = x => {
    if (!x || typeof x !== 'object') return false;
    if (x.k === 'ref') return x.col === c;
    if (x.k === 'exists') return inR(x.rel);
    if (x.k === 'case') return x.w.some(([p, v]) => inX(p) || inX(v)) || inX(x.e);
    return Array.isArray(x.a) && x.a.some(inX);
  };
  const inR = rel => {
    if (seen.has(rel)) return false;
    seen.add(rel);
    const xs = [rel.pred, rel.on, ...(rel.items ?? []).map(i => i.expr), ...(rel.keys ?? []).map(k => k.expr), ...(rel.aggs ?? []).flatMap(x => [x.arg, x.extra?.delim, ...(x.extra?.order ?? []).map(o => o.expr)])];
    if (xs.some(inX)) return true;
    return [rel.src, rel.left, rel.right, ...(rel.srcs ?? [])].some(k => k && inR(k));
  };
  return inR(r);
}
