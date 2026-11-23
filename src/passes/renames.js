// Renames: a projection whose values are its input's columns, each once, only names them anew
// (decorrelation's D, sharing's reads of a definition). It is dropped, and what reads its
// columns reads its input's. Kept under a distinct, where the columns it leaves out would change
// the rows, and where it makes no column (SQL has no SELECT of none).
import { kids } from './decorrelate.js';

export function renames(root) {
  const as = new Map();   // a dropped projection's column -> its input's
  // How many nodes make each column: a column two make (a table's scan read in two places, and
  // a projection that names a definition's column as it) is not renamed, nor what reads it.
  const makers = new Map(), seen = new Set();
  const count = r => {
    if (seen.has(r)) return;
    seen.add(r);
    kids(r).forEach(count);
    if (r.k === 'shared') count(r.def.rel);
    const own = r.k === 'project' ? r.items.map(i => i.col) : r.k === 'aggregate' ? [...r.keys.map(k => k.col), ...r.aggs.map(x => x.col)]
      : r.k === 'window' ? r.fns.map(f => f.col) : ['scan', 'values', 'union', 'shared', 'series'].includes(r.k) ? r.cols : [];
    for (const c of own) makers.set(c, (makers.get(c) ?? 0) + 1);
  };
  count(root);
  (root.defs ?? []).forEach(d => count(d.rel));
  const to = c => { while (as.has(c)) c = as.get(c); return c; };
  const R = (r, parent) => {
    let out;
    switch (r.k) {
      case 'select': case 'distinct': case 'project': case 'aggregate': case 'window': case 'output': out = { ...r, src: R(r.src, r) }; break;
      case 'join': out = { ...r, left: R(r.left, r), right: R(r.right, r) }; break;
      case 'union': out = { ...r, srcs: r.srcs.map(s => R(s, r)) }; break;
      case 'series': out = r.src ? { ...r, src: R(r.src, r) } : r; break;
      default: out = r;
    }
    if (out.k === 'project' && parent?.k !== 'distinct' && out.items.length && out.items.every(i => i.expr.k === 'ref')) {
      const srcs = out.items.map(i => to(i.expr.col));
      if (new Set(srcs).size === srcs.length && srcs.every(c => out.src.cols.includes(c)) && out.items.every(i => makers.get(i.col) === 1)) {
        out.items.forEach((i, j) => { if (i.col !== srcs[j]) as.set(i.col, srcs[j]); });
        return out.src;
      }
    }
    return out;
  };
  const top = R(root, null);
  const defs = (root.defs ?? []).map(d => { d.rel = R(d.rel, null); return d; });
  // Every column read, as the column it is now.
  const S = x => sub(x, to);
  const fix = r => {
    let out;
    switch (r.k) {
      case 'select': { const src = fix(r.src); out = { ...r, src, pred: S(r.pred), cols: src.cols }; break; }
      case 'distinct': { const src = fix(r.src); out = { ...r, src, cols: src.cols }; break; }
      case 'project': out = { ...r, src: fix(r.src), items: r.items.map(i => ({ ...i, expr: S(i.expr) })) }; break;
      case 'aggregate': out = { ...r, src: fix(r.src), keys: r.keys.map(k => ({ ...k, expr: S(k.expr) })), aggs: r.aggs.map(a => ({ ...a, arg: a.arg && S(a.arg), extra: a.extra && { ...a.extra, ...(a.extra.delim ? { delim: S(a.extra.delim) } : {}), ...(a.extra.k ? { k: S(a.extra.k) } : {}), ...(a.extra.order ? { order: a.extra.order.map(o => ({ ...o, expr: S(o.expr) })) } : {}) } })) }; break;
      case 'window': { const src = fix(r.src); out = { ...r, src, part: r.part.map(S), fns: r.fns.map(f => ({ ...f, order: f.order.map(o => ({ ...o, expr: S(o.expr) })) })), cols: [...src.cols, ...r.fns.map(f => f.col)] }; break; }
      case 'join': { const left = fix(r.left), right = fix(r.right); out = { ...r, left, right, on: r.on && S(r.on), cols: [...left.cols, ...right.cols] }; break; }
      case 'union': out = { ...r, srcs: r.srcs.map(fix), picks: r.picks.map(p => p.map(to)) }; break;
      case 'shared': out = { ...r, picks: r.picks.map(to) }; break;
      case 'series': out = { ...r, ...(r.src ? { src: fix(r.src) } : {}), start: S(r.start), end: S(r.end), step: S(r.step) }; break;
      case 'values': out = { ...r, rows: r.rows.map(row => row.map(S)) }; break;
      case 'output': out = { ...r, src: fix(r.src), items: r.items.map(i => ({ ...i, expr: S(i.expr) })), order: r.order.map(o => ({ ...o, expr: S(o.expr) })) }; break;
      default: out = r;
    }
    return out;
  };
  for (const d of defs) d.rel = fix(d.rel);
  return { ...fix(top), defs };
}

function sub(x, to) {
  if (!x || typeof x !== 'object') return x;
  if (x.k === 'ref') { const c = to(x.col); return c === x.col ? x : { ...x, col: c }; }
  if (x.k === 'case') return { ...x, w: x.w.map(([c, v]) => [sub(c, to), sub(v, to)]), e: sub(x.e, to) };
  if (Array.isArray(x.a)) return { ...x, a: x.a.map(y => sub(y, to)) };
  return x;
}
