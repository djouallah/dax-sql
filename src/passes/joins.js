// Joins: a σ over a cross join (or an inner join) is the inner join on its condition, as
// decorrelation leaves one (D crossed with the rows, then matched on its values).
import * as P from '../plan.js';
import { mapKids } from './decorrelate.js';

export function joins(root) {
  const J = r => {
    r = mapKids(r, J);
    if (r.k === 'select' && r.src.k === 'join' && (r.src.kind === 'cross' || r.src.kind === 'inner')) {
      const j = r.src;
      return P.join('inner', j.left, j.right, j.on ? P.and([j.on, r.pred]) : r.pred);
    }
    return r;
  };
  for (const d of root.defs ?? []) d.rel = J(d.rel);
  return { ...root, src: J(root.src) };
}
