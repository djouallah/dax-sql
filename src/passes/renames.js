// Renames: a projection whose values are its input's columns, each once, only names them anew
// (decorrelation's D, sharing's reads of a definition). It is dropped, and what is above it reads
// its input's columns. Bottom up, each node takes its kids' renames (a column of a dropped
// projection -> the input's), so a rename holds above the projection only. Kept where it leaves
// columns out under a distinct (fewer columns would make fewer rows). In the correlated plan, a
// rename holds too where the row is read from inside: an apply's right (its left's row), an
// EXISTS in a condition (the row it tests).
export function renames(root) {
  const defMaps = new Map();
  const R = (r, parent, outer = c => c) => {
    const maps = [];
    let rel;
    const K = (k, i) => { const o = R(k, r, outer); maps[i] = o.map; return o.rel; };
    switch (r.k) {
      case 'select': case 'distinct': case 'project': case 'aggregate': case 'window': case 'output': rel = { ...r, src: K(r.src, 0) }; break;
      case 'join': rel = { ...r, left: K(r.left, 0), right: K(r.right, 1) }; break;
      case 'apply': {
        const left = K(r.left, 0), lm = maps[0];
        const o = R(r.right, r, c => lm?.get(c) ?? outer(c));
        maps[1] = o.map;
        rel = { ...r, left, right: o.rel };
        break;
      }
      case 'union': rel = { ...r, srcs: r.srcs.map((s, i) => K(s, i)) }; break;
      case 'series': rel = r.src ? { ...r, src: K(r.src, 0) } : { ...r }; break;
      default: rel = { ...r };
    }
    const map = new Map();
    for (const m of maps) if (m) for (const [a, b] of m) map.set(a, b);
    const to = c => map.get(c) ?? outer(c), S = x => sub(x, to, rx => R(rx, null, to).rel);
    switch (rel.k) {
      case 'select': rel.pred = S(rel.pred); rel.cols = rel.src.cols; break;
      case 'distinct': rel.cols = rel.src.cols; break;
      case 'project': rel.items = rel.items.map(i => ({ ...i, expr: S(i.expr) })); break;
      case 'aggregate':
        rel.keys = rel.keys.map(k => ({ ...k, expr: S(k.expr) }));
        rel.aggs = rel.aggs.map(a => ({ ...a, arg: a.arg && S(a.arg), extra: a.extra && { ...a.extra, ...(a.extra.delim ? { delim: S(a.extra.delim) } : {}), ...(a.extra.k ? { k: S(a.extra.k) } : {}), ...(a.extra.order ? { order: a.extra.order.map(o => ({ ...o, expr: S(o.expr) })) } : {}) } }));
        break;
      case 'window':
        rel.part = rel.part.map(S);
        rel.fns = rel.fns.map(f => ({ ...f, order: f.order.map(o => ({ ...o, expr: S(o.expr) })) }));
        rel.cols = [...rel.src.cols, ...rel.fns.map(f => f.col)];
        break;
      case 'join': rel.on = rel.on && S(rel.on); rel.cols = [...rel.left.cols, ...rel.right.cols]; break;
      case 'apply': rel.cols = [...rel.left.cols, ...rel.right.cols]; break;
      case 'union': rel.picks = rel.picks.map((p, i) => p.map(c => maps[i]?.get(c) ?? c)); break;
      case 'shared': { const m = defMaps.get(rel.def); if (m) rel.picks = rel.picks.map(c => m.get(c) ?? c); break; }
      case 'series': rel.start = S(rel.start); rel.end = S(rel.end); rel.step = S(rel.step); break;
      case 'values': rel.rows = rel.rows.map(row => row.map(S)); break;
      case 'output': rel.items = rel.items.map(i => ({ ...i, expr: S(i.expr) })); rel.order = rel.order.map(o => ({ ...o, expr: S(o.expr) })); break;
    }
    if (rel.k === 'project' && rel.items.length && rel.items.every(i => i.expr.k === 'ref')) {
      const srcs = rel.items.map(i => i.expr.col);
      const all = srcs.length === rel.src.cols.length;
      if (new Set(srcs).size === srcs.length && srcs.every(c => rel.src.cols.includes(c)) && (parent?.k !== 'distinct' || all)) {
        const out = new Map(map);
        rel.items.forEach((i, j) => { if (i.col !== srcs[j]) out.set(i.col, srcs[j]); });
        return { rel: rel.src, map: visible(out, rel.src) };
      }
    }
    return { rel, map: visible(map, rel) };
  };
  // The definitions first (each reads those before it): what reads one takes its renames.
  for (const d of root.defs ?? []) {
    const o = R(d.rel, null);
    d.rel = o.rel;
    defMaps.set(d, o.map);
  }
  return { ...R(root, null).rel, defs: root.defs ?? [] };
}

// The renames that hold above r: those to a column r gives (not past a node that makes its own).
function visible(map, r) {
  const cols = new Set(r.cols);
  return new Map([...map].filter(([, b]) => cols.has(b)));
}

// x with its columns renamed; an EXISTS' relation renamed (rel) under the row around it.
function sub(x, to, rel = null) {
  if (!x || typeof x !== 'object') return x;
  if (x.k === 'ref') { const c = to(x.col); return c === x.col ? x : { ...x, col: c }; }
  if (x.k === 'exists') return rel ? { ...x, rel: rel(x.rel) } : x;
  if (x.k === 'case') return { ...x, w: x.w.map(([c, v]) => [sub(c, to, rel), sub(v, to, rel)]), e: sub(x.e, to, rel) };
  if (Array.isArray(x.a)) return { ...x, a: x.a.map(y => sub(y, to, rel)) };
  return x;
}
