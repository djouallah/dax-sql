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
import { mapKids, conjuncts, free, subst } from './decorrelate.js';
import { canon, text } from './fuse.js';

// A scalar reading R's columns for R''s (an EXISTS' relation too).
const remap = (x, map) => x && subst(x, map);
const remapExtra = (e, map) => (e ? { ...e, ...(e.delim ? { delim: remap(e.delim, map) } : {}), ...(e.k ? { k: remap(e.k, map) } : {}), ...(e.order ? { order: e.order.map(o => ({ ...o, expr: remap(o.expr, map) })) } : {}) } : e);

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
      const fr = free(r.right);
      if (path.some(b => b.right.cols.some(c => fr.has(c)))) break;
      if (a.right.cols.some(c => fr.has(c))) continue;
      const into = { ...a, right: merged, cols: [...a.left.cols, ...merged.cols] };
      const rebuilt = path.reduceRight((below, b) => ({ ...b, left: below, cols: [...below.cols, ...b.right.cols] }), into);
      return rebuilt;
    }
    return r;
  };
  for (const d of root.defs ?? []) d.rel = F(d.rel);
  return { ...root, src: F(root.src) };
}

const oneRow = r => r.k === 'aggregate' && !r.keys.length;
// A grouping's rows and its filter's terms (none when it is over no filter).
const rowsOf = g => (g.src.k === 'select' ? { rel: g.src.src, terms: conjuncts(g.src.pred) } : { rel: g.src, terms: [] });

// g's grouping with h's aggregates joined to it, or null: the same rows, h's filter g's and more.
function merge(g, h) {
  const G = rowsOf(g), H = rowsOf(h);
  // deep: two copies whose EXISTS reads the row it tests are the same rows.
  const a = canon(G.rel, true), b = canon(H.rel, true);
  if (a.key !== b.key) return null;
  const map = new Map(b.cols.map((c, i) => [c, a.cols[i]]));
  const gs = G.terms.map(c => text(c, a.ids)), hs = H.terms;
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

