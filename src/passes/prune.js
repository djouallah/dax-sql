// Pruning: a relation keeps only the columns something above it reads. A table's scan reads
// the columns the query uses, a projection drops the values nobody reads, a grouping the
// aggregates nobody reads; a definition keeps what any of its readers needs. The rows do not
// change: a distinct keeps all its columns (fewer would make fewer rows), a grouping all its keys,
// and a relation of no column keeps one (SQL has no SELECT of none).
import { free } from './decorrelate.js';

export function prune(root) {
  const needs = new Map();   // definition -> the columns of its relation its readers need
  const need = (d, c) => { if (!needs.has(d)) needs.set(d, new Set()); needs.get(d).add(c); };
  const N = (r, want) => {
    switch (r.k) {
      case 'scan': {
        const cols = r.cols.filter(c => want.has(c));
        return { ...r, cols: cols.length ? cols : r.cols.slice(0, 1) };
      }
      case 'values': {
        let at = r.cols.map((c, i) => (want.has(c) ? i : -1)).filter(i => i >= 0);
        if (!at.length) at = [0];
        return { ...r, cols: at.map(i => r.cols[i]), rows: r.rows.map(row => at.map(i => row[i])) };
      }
      case 'select': {
        const src = N(r.src, union(want, refs(r.pred)));
        return { ...r, src, pred: S(r.pred), cols: src.cols };
      }
      case 'project': {
        let items = r.items.filter(i => want.has(i.col));
        if (!items.length && r.items.length) items = [r.items[0]];
        const src = N(r.src, union(...items.map(i => refs(i.expr))));
        return { ...r, src, items: items.map(i => ({ ...i, expr: S(i.expr) })), cols: items.map(i => i.col) };
      }
      case 'distinct': {
        const src = N(r.src, new Set(r.src.cols));
        return { ...r, src, cols: src.cols };
      }
      case 'aggregate': {
        let aggs = r.aggs.filter(a => want.has(a.col));
        if (!r.keys.length && !aggs.length && r.aggs.length) aggs = [r.aggs[0]];
        const src = N(r.src, union(...r.keys.map(k => refs(k.expr)), ...aggs.map(a => aggRefs(a))));
        return { ...r, src, keys: r.keys.map(k => ({ ...k, expr: S(k.expr) })), aggs: aggs.map(a => ({ ...a, arg: a.arg && S(a.arg) })), cols: [...r.keys.map(k => k.col), ...aggs.map(a => a.col)] };
      }
      case 'join': {
        const on = r.on ? refs(r.on) : new Set();
        const left = N(r.left, union(want, on)), right = N(r.right, union(want, on));
        return { ...r, left, right, on: r.on && S(r.on), cols: [...left.cols, ...right.cols] };
      }
      case 'apply': {
        // The correlated plan's: the right for each row of the left. One row for each (a grouping
        // of no key) that nothing reads is no work; the left keeps what the right reads of it.
        const one = x => (x.k === 'aggregate' && !x.keys.length) || (x.k === 'project' && one(x.src));
        if (one(r.right) && !r.right.cols.some(c => want.has(c))) return N(r.left, want);
        const left = N(r.left, union(want, free(r.right))), right = N(r.right, want);
        return { ...r, left, right, cols: [...left.cols, ...right.cols] };
      }
      case 'union': {
        let at = r.cols.map((c, i) => (want.has(c) ? i : -1)).filter(i => i >= 0);
        if (!at.length) at = [0];
        const srcs = r.srcs.map((s, k) => N(s, new Set(at.map(i => r.picks[k][i]))));
        return { ...r, srcs, picks: r.picks.map(p => at.map(i => p[i])), cols: at.map(i => r.cols[i]) };
      }
      case 'window': {
        const fns = r.fns.filter(f => want.has(f.col));
        if (!fns.length) return N(r.src, want);
        const src = N(r.src, union(want, ...r.part.map(p => refs(p)), ...fns.flatMap(f => f.order.map(o => refs(o.expr)))));
        return { ...r, src, part: r.part.map(S), fns: fns.map(f => ({ ...f, order: f.order.map(o => ({ ...o, expr: S(o.expr) })) })), cols: [...src.cols, ...fns.map(f => f.col)] };
      }
      case 'shared': {
        let at = r.cols.map((c, i) => (want.has(c) ? i : -1)).filter(i => i >= 0);
        if (!at.length) at = [0];
        for (const i of at) need(r.def, r.picks[i]);
        return { ...r, picks: at.map(i => r.picks[i]), cols: at.map(i => r.cols[i]) };
      }
      case 'series': return r.src ? { ...r, src: N(r.src, union(refs(r.start), refs(r.end), refs(r.step))) } : r;
      case 'output': {
        const src = N(r.src, union(...r.items.map(i => refs(i.expr)), ...r.order.map(o => refs(o.expr))));
        return { ...r, src, items: r.items.map(i => ({ ...i, expr: S(i.expr) })), order: r.order.map(o => ({ ...o, expr: S(o.expr) })) };
      }
    }
    throw new Error(`prune: ${r.k}`);
  };
  // A scalar's subqueries (EXISTS): their relations, of the columns they read themselves.
  const S = x => mapExists(x, rel => N(rel, new Set()));
  const aggRefs = a => union(a.arg ? refs(a.arg) : new Set(), ...['delim', 'k'].map(k => (a.extra?.[k] ? refs(a.extra[k]) : new Set())), ...(a.extra?.order ?? []).map(o => refs(o.expr)));

  // The root: the output, whose items and order are what the query reads.
  const top = N(root, new Set());
  // Each definition after all that read it (they come after it): its readers' needs are known.
  const defs = root.defs ?? [];
  for (let i = defs.length - 1; i >= 0; i--) {
    const d = defs[i], want = needs.get(d) ?? new Set(d.rel.cols.slice(0, 1));
    d.rel = N(d.rel, want);
  }
  return { ...top, defs };
}

const union = (...sets) => { const out = new Set(); for (const s of sets) for (const c of s) out.add(c); return out; };
function refs(x, out = new Set()) {
  if (!x || typeof x !== 'object') return out;
  if (x.k === 'ref') { out.add(x.col); return out; }
  if (x.k === 'case') { x.w.forEach(([c, v]) => { refs(c, out); refs(v, out); }); refs(x.e, out); return out; }
  // A subquery reads the columns of the row around it it names (none, in an optimized plan).
  if (x.k === 'exists') { free(x.rel).forEach(c => out.add(c)); return out; }
  if (Array.isArray(x.a)) x.a.forEach(y => refs(y, out));
  return out;
}
function mapExists(x, f) {
  if (!x || typeof x !== 'object') return x;
  if (x.k === 'exists') return { ...x, rel: f(x.rel) };
  if (x.k === 'case') return { ...x, w: x.w.map(([c, v]) => [mapExists(c, f), mapExists(v, f)]), e: mapExists(x.e, f) };
  if (Array.isArray(x.a)) return { ...x, a: x.a.map(y => mapExists(y, f)) };
  return x;
}
