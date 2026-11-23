// Fusion: measures over the same rows, grouped by the same keys and joined to the same rows,
// are one grouping that computes them all. Decorrelation leaves each measure of a
// SUMMARIZECOLUMNS (and of a row of an iterator) its own grouping, left-joined to the groups:
//
//   π(⟕_{outer ≡ key}(L, γ_key aggs₁(R)))   and, around it,   π(⟕_{outer ≡ key}(…, γ_key aggs₂(R')))
//
// where R and R' are the same relation (the same operators over the same tables, up to their
// columns' ids): one γ_key aggs₁ aggs₂(R) instead, read by both.
import * as P from '../plan.js';
import { kids, scalarsOf, mapKids } from './decorrelate.js';

export function fuse(root) {
  for (const d of root.defs ?? []) d.rel = F(d.rel);
  return { ...root, src: F(root.src) };
}

function F(r) {
  r = mapKids(r, F);
  const m = measureJoin(r);
  if (!m) return r;
  const into = mergeInto(m.left, m);
  if (!into) return r;
  // One projection over the join (the next measure finds the join under it): r's items read
  // through into's.
  const by = new Map(into.items.map(i => [i.col, i.expr]));
  return P.projectAs(into.src, r.items.map(i => ({ col: i.col, expr: remap(i.expr, by, true) })));
}

// π(⟕(left, γ, on)) with on the AND of each outer expression ≡ (or =) the γ's key: { left, g, outer, ops }.
function measureJoin(r) {
  if (r.k !== 'project' || r.src.k !== 'join' || r.src.kind !== 'left') return null;
  const g = r.src.right;
  if (g.k !== 'aggregate' || !g.keys.length) return null;
  const on = conjuncts(r.src.on);
  if (on.length !== g.keys.length) return null;
  const outer = [], ops = [];
  for (let i = 0; i < on.length; i++) {
    const c = on[i];
    if (c.k !== 'pop' || (c.op !== 'key' && c.op !== 'eq') || c.a[1].k !== 'ref' || c.a[1].col !== g.keys[i].col) return null;
    outer.push(c.a[0]);
    ops.push(c.op);
  }
  return { proj: r, left: r.src.left, on: r.src.on, g, outer, ops };
}
const conjuncts = x => (x.k === 'pop' && x.op === 'and' ? x.a.flatMap(conjuncts) : x.k === 'op' && x.op === 'and' ? x.a.flatMap(conjuncts) : [x]);

// The left chain of measure joins below, with m's aggregates in the first grouping like m's:
// each π on the way passing m's aggregates through. Null when there is none.
function mergeInto(L, m) {
  const n = measureJoin(L);
  if (!n) return null;
  const map = sameGroup(n, m);
  if (map) {
    const aggs = m.g.aggs.map(a => ({ ...a, arg: a.arg && remap(a.arg, map), extra: remapExtra(a.extra, map) }));
    const g = { ...n.g, aggs: [...n.g.aggs, ...aggs], cols: [...n.g.cols, ...aggs.map(a => a.col)] };
    return P.projectAs(P.join('left', n.left, g, n.on), [...n.proj.items, ...pass(m.g.aggs)]);
  }
  const deeper = mergeInto(n.left, m);
  return deeper ? P.projectAs(P.join('left', deeper, n.g, n.on), [...n.proj.items, ...pass(m.g.aggs)]) : null;
}
const pass = aggs => aggs.map(a => ({ col: a.col, expr: P.ref(a.col) }));

// Whether n's grouping is m's: the same outer values, the same keys over the same relation.
// -> the map from m's columns to n's, or null.
function sameGroup(n, m) {
  if (n.outer.length !== m.outer.length || n.ops.some((o, i) => o !== m.ops[i])) return null;
  if (!n.outer.every((x, i) => same(x, m.outer[i]))) return null;
  const a = canon(n.g.src), b = canon(m.g.src);
  if (a.key !== b.key) return null;
  const map = new Map(b.cols.map((c, i) => [c, a.cols[i]]));
  const keyOf = (g, cv) => g.keys.map(k => text(k.expr, cv)).join('|');
  return keyOf(n.g, a.ids) === keyOf(m.g, b.ids) ? map : null;
}
const same = (x, y) => text(x, new Map()) === text(y, new Map());

// --- a relation up to its columns' ids ---------------------------------------------------

// { key, cols, ids }: the relation as text, its columns numbered in the order they are made
// (a column made outside it named by its own id), and those columns in that order.
function canon(rel) {
  const ids = new Map(), cols = [];
  const number = r => {
    for (const k of kids(r)) number(k);
    for (const c of r.cols) if (!ids.has(c)) { ids.set(c, ids.size); cols.push(c); }
  };
  number(rel);
  const parts = [];
  const walk = r => {
    for (const k of kids(r)) walk(k);
    parts.push(`${r.k}:${nodeText(r, ids)}`);
  };
  walk(rel);
  return { key: parts.join(';'), cols, ids };
}

let defIds = new WeakMap(), nextDef = 0;
function nodeText(r, ids) {
  const S = x => text(x, ids);
  switch (r.k) {
    case 'scan': return `${r.table.name}`;
    case 'shared': { if (!defIds.has(r.def)) defIds.set(r.def, nextDef++); return `v${defIds.get(r.def)}`; }
    case 'join': return `${r.kind}`;
    case 'apply': return `${r.outer}`;
    case 'union': return r.picks.map(p => p.map(c => ids.get(c)).join(',')).join('/');
    case 'aggregate': return `${r.keys.map(k => S(k.expr)).join(',')}|${r.aggs.map(a => `${a.fn}(${a.arg ? S(a.arg) : ''})${JSON.stringify({ ...a.extra, delim: a.extra?.delim && S(a.extra.delim), k: a.extra?.k && S(a.extra.k), order: a.extra?.order?.map(o => `${S(o.expr)} ${o.desc}`) })}`).join(',')}`;
    case 'window': return `${r.part.map(S).join(',')}|${r.fns.map(f => `${f.fn}(${f.order.map(o => `${S(o.expr)} ${o.desc} ${o.mode} ${o.blanks} ${o.t}`).join(',')})`).join(',')}`;
    case 'values': return `${r.cols.map(c => c.t).join(',')}|${r.rows.map(row => row.map(S).join(',')).join('/')}`;
    case 'series': return `${S(r.start)},${S(r.end)},${S(r.step)},${r.t}`;
  }
  return scalarsOf(r).map(S).join(',');
}

function text(x, ids) {
  if (!x || typeof x !== 'object') return String(x);
  const S = y => text(y, ids);
  switch (x.k) {
    case 'ref': return ids.has(x.col) ? `#${ids.get(x.col)}` : `@${x.col.id}`;
    case 'lit': return `${x.t}:${JSON.stringify(x.v)}`;
    case 'op': return `${x.op}(${x.a.map(S).join(',')})`;
    case 'fn': return `${x.name}(${x.a.map(S).join(',')})`;
    case 'pop': return `${x.op}${x.name ?? ''}${x.to ?? ''}(${x.a.map(S).join(',')})`;
    case 'case': return `case(${x.w.map(([c, v]) => `${S(c)}:${S(v)}`).join(',')};${S(x.e)})`;
    case 'exists': { const c = canon(x.rel); return `exists(${c.key})`; }
  }
  return `?${x.k}`;
}

// A scalar with m's columns as n's (`exprs`: map's values are expressions, not columns).
function remap(x, map, exprs = false) {
  if (!x || typeof x !== 'object') return x;
  if (x.k === 'ref') return map.has(x.col) ? (exprs ? map.get(x.col) : P.ref(map.get(x.col))) : x;
  if (x.k === 'op' || x.k === 'fn' || x.k === 'pop') return { ...x, a: x.a.map(y => remap(y, map, exprs)) };
  if (x.k === 'case') return { ...x, w: x.w.map(([c, v]) => [remap(c, map, exprs), remap(v, map, exprs)]), e: remap(x.e, map, exprs) };
  return x;
}
const remapExtra = (e, map) => (e ? { ...e, ...(e.delim ? { delim: remap(e.delim, map) } : {}), ...(e.k ? { k: remap(e.k, map) } : {}), ...(e.order ? { order: e.order.map(o => ({ ...o, expr: remap(o.expr, map) })) } : {}) } : e);
