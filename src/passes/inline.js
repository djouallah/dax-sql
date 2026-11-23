// Inlining: a definition read once is its relation where it is read (written once either way; a
// definition is for a relation read in several places). Its read becomes a projection of the
// relation to the read's columns, which renames.js drops. Reads in an EXISTS' relation count, and
// are rewritten, as the others.
import * as P from '../plan.js';
import { kids, mapKids, scalarsOf, mapScalars } from './decorrelate.js';

export function inline(root) {
  const defs = root.defs ?? [];
  const reads = new Map();
  const count = r => {
    if (r.k === 'shared') reads.set(r.def, (reads.get(r.def) ?? 0) + 1);
    kids(r).forEach(count);
    for (const x of scalarsOf(r)) existsRels(x).forEach(count);
  };
  count(root);
  defs.forEach(d => count(d.rel));
  const once = new Set(defs.filter(d => reads.get(d) === 1));
  if (!once.size) return root;
  const I = r => {
    if (r.k === 'shared' && once.has(r.def)) {
      const rel = I(r.def.rel);
      return P.projectAs(rel, r.cols.map((c, i) => ({ col: c, expr: P.ref(r.picks[i]) })));
    }
    return mapScalars(mapKids(r, I), x => inExists(x, I));
  };
  const kept = defs.filter(d => !once.has(d));
  for (const d of kept) d.rel = I(d.rel);
  kept.forEach((d, i) => { d.n = i + 1; });
  return { ...I(root), defs: kept };
}

// The relations of a scalar's EXISTS.
function existsRels(x, out = []) {
  if (!x || typeof x !== 'object') return out;
  if (x.k === 'exists') { out.push(x.rel); return out; }
  if (x.k === 'case') { x.w.forEach(([c, v]) => { existsRels(c, out); existsRels(v, out); }); existsRels(x.e, out); return out; }
  if (Array.isArray(x.a)) x.a.forEach(y => existsRels(y, out));
  return out;
}
// A scalar with f applied to its EXISTS' relations.
function inExists(x, f) {
  if (!x || typeof x !== 'object') return x;
  if (x.k === 'exists') return { ...x, rel: f(x.rel) };
  if (x.k === 'case') return { ...x, w: x.w.map(([c, v]) => [inExists(c, f), inExists(v, f)]), e: inExists(x.e, f) };
  if (Array.isArray(x.a)) return { ...x, a: x.a.map(y => inExists(y, f)) };
  return x;
}
