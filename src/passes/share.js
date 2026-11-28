// Sharing: a subtree the plan holds more than once (the same operators over the same tables, up
// to its columns' ids: a filter's rows each measure reads, a grouping two branches make) is one
// definition, read where each was. Each place reads it through a projection that gives the
// columns their ids there, so nothing above it changes. A subtree with a join, a grouping or a
// distinct in it, and reading no column from outside, is shared; a table or a constant alone
// is not (reading one is no work).
import * as P from '../plan.js';
import { kids, scalarsOf, mapKids, existsOf } from './decorrelate.js';
import { clone } from './clone.js';

export function share(root) {
  const keys = new WeakMap(), count = new Map();
  // Each subtree's key: its operator, its own values (a column as the position its kids give
  // it), its kids' keys. A column from outside is named by its id ('@'): no subtree with one is
  // shared.
  const key = r => {
    if (keys.has(r)) return keys.get(r);
    const ks = kids(r).map(key);
    const at = new Map();
    kids(r).forEach((k, i) => k.cols.forEach((c, j) => { if (!at.has(c)) at.set(c, `${i}.${j}`); }));
    if (r.k === 'shared') r.def.rel.cols.forEach((c, j) => at.set(c, `d.${j}`));
    const k = `${r.k}(${ks.join(',')}){${own(r, x => text(x, at, key))}}`;
    keys.set(r, k);
    return k;
  };
  // A node twice in the tree (the same object) is written twice: counted twice.
  const all = r => { count.set(key(r), (count.get(key(r)) ?? 0) + 1); kids(r).forEach(all); };
  for (const d of root.defs ?? []) all(d.rel);
  all(root.src);

  const defs = new Map();   // key -> definition
  // Not a join at the top (through projections): its rows are as many as its tables' (a fact
  // joined to its dimensions), written once they are read whole at each place, the conditions
  // each place puts on them no longer below the join; what is shared inside it still is.
  const top = r => (r.k === 'project' ? top(r.src) : r);
  const worth = r => r.k !== 'shared' && !key(r).includes('@') && hasWork(r) && top(r).k !== 'join';
  // A node the tree holds twice (the same object) becomes one node, read twice.
  const memo = new Map();
  const S = r => {
    if (!memo.has(r)) memo.set(r, S1(r));
    return memo.get(r);
  };
  const S1 = r => {
    const k = key(r);
    if (count.get(k) > 1 && worth(r)) {
      let d = defs.get(k);
      if (!d) {
        d = P.definition(null, 0);
        defs.set(k, d);
        // Under columns of its own: each place reads it through a projection to its columns.
        d.rel = clone(mapKids(r, S)).rel;
      }
      const s = P.shared(d);
      return P.projectAs(s, r.cols.map((c, i) => ({ col: c, expr: P.ref(s.cols[i]) })));
    }
    return mapKids(r, S);
  };
  const old = (root.defs ?? []).map(d => { d.rel = S(d.rel); return d; });
  const src = S(root.src);
  return { ...root, src, defs: order([...defs.values(), ...old]) };
}

// Whether r holds work worth writing once: a join, a grouping, a distinct, a window.
function hasWork(r) {
  if (r.k === 'join' || r.k === 'aggregate' || r.k === 'distinct' || r.k === 'window' || r.k === 'union') return true;
  return kids(r).some(hasWork);
}

// The definitions, each after those it reads (in an EXISTS too: whether a table has its blank row).
function order(defs) {
  const out = [], done = new Set(), on = new Set();
  const reads = (r, acc) => {
    if (r.k === 'shared') acc.add(r.def);
    kids(r).forEach(k => reads(k, acc));
    for (const x of scalarsOf(r)) existsOf(x).forEach(e => reads(e, acc));
    return acc;
  };
  const place = d => {
    if (done.has(d) || on.has(d)) return;
    on.add(d);
    for (const e of reads(d.rel, new Set())) place(e);
    on.delete(d);
    done.add(d);
    out.push(d);
  };
  defs.forEach(place);
  out.forEach((d, i) => { d.n = i + 1; });
  return out;
}

// A node's own values as text (its kids are in its key apart).
function own(r, S) {
  switch (r.k) {
    case 'scan': return `${r.table.name}`;
    case 'shared': return `${ids(r.def)}|${r.picks.map(c => r.def.rel.cols.indexOf(c)).join(',')}`;
    case 'join': return `${r.kind}|${r.on ? S(r.on) : ''}`;
    case 'apply': return `${r.outer ? 'outer' : 'inner'}`;
    case 'union': return r.picks.map((p, k) => p.map(c => r.srcs[k].cols.indexOf(c)).join(',')).join('/');
    case 'aggregate': return `${r.keys.map(k => S(k.expr)).join(',')}|${r.aggs.map(a => `${a.fn}(${a.arg ? S(a.arg) : ''})${extra(a.extra, S)}`).join(',')}`;
    case 'window': return `${r.part.map(S).join(',')}|${r.fns.map(f => `${f.fn}(${f.order.map(o => `${S(o.expr)} ${o.desc} ${o.mode} ${o.blanks} ${o.t}`).join(',')})`).join(',')}`;
    case 'values': return `${r.cols.map(c => c.t).join(',')}|${r.rows.map(row => row.map(S).join(',')).join('/')}`;
    case 'series': return `${S(r.start)},${S(r.end)},${S(r.step)},${r.t}`;
    case 'project': return r.items.map(i => `${i.col.t}:${S(i.expr)}`).join(',');
  }
  return `${r.cols.length}|${scalarsOf(r).map(S).join(',')}`;
}
const extra = (e, S) => (e ? JSON.stringify({ ...e, delim: e.delim && S(e.delim), k: e.k && S(e.k), order: e.order?.map(o => `${S(o.expr)} ${o.desc}`) }) : '');
const defIds = new WeakMap();
let nextDef = 0;
const ids = d => { if (!defIds.has(d)) defIds.set(d, nextDef++); return defIds.get(d); };

function text(x, at, key) {
  if (!x || typeof x !== 'object') return String(x);
  const S = y => text(y, at, key);
  switch (x.k) {
    case 'ref': return at.has(x.col) ? `#${at.get(x.col)}` : `@${x.col.id}`;
    case 'lit': return `${x.t}:${JSON.stringify(x.v)}`;
    case 'param': return `param:${x.t}:${x.v}`;
    case 'op': case 'fn': return `${x.k}${x.op ?? x.name}(${x.a.map(S).join(',')})`;
    case 'pop': return `${x.op}${x.name ?? ''}${x.to ?? ''}:${x.t}(${x.a.map(S).join(',')})`;
    case 'case': return `case(${x.w.map(([c, v]) => `${S(c)}:${S(v)}`).join(',')};${S(x.e)})`;
    // A subquery's relation: its key (a column of the row around it, from outside it: '@').
    case 'exists': return `exists(${key(x.rel)})`;
  }
  return `?${x.k}`;
}
