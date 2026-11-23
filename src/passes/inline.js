// Inlining: a definition read once is its relation where it is read (written once either way; a
// definition is for a relation read in several places). Its read becomes a projection of the
// relation to the read's columns, which renames.js drops.
import * as P from '../plan.js';
import { kids, mapKids } from './decorrelate.js';

export function inline(root) {
  const defs = root.defs ?? [];
  const reads = new Map();
  const count = r => { if (r.k === 'shared') reads.set(r.def, (reads.get(r.def) ?? 0) + 1); kids(r).forEach(count); };
  count(root);
  defs.forEach(d => count(d.rel));
  const once = new Set(defs.filter(d => reads.get(d) === 1));
  if (!once.size) return root;
  const I = r => {
    if (r.k === 'shared' && once.has(r.def)) {
      const rel = I(r.def.rel);
      return P.projectAs(rel, r.cols.map((c, i) => ({ col: c, expr: P.ref(r.picks[i]) })));
    }
    return mapKids(r, I);
  };
  const kept = defs.filter(d => !once.has(d));
  for (const d of kept) d.rel = I(d.rel);
  kept.forEach((d, i) => { d.n = i + 1; });
  return { ...I(root), defs: kept };
}
