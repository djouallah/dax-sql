// A copy of a relation under columns of its own (the plan's ids are each one relation's): every
// column made inside it is a new one; a column it reads from outside, a definition it reads,
// and the model's objects stay the same.
import { newCol } from '../plan.js';
import { free } from './decorrelate.js';

const KEEP = new Set(['lineage', 'table', 'def']);

export function clone(rel) {
  const outside = free(rel), map = new Map(), seen = new Map();
  const isCol = x => typeof x.id === 'number' && 'name' in x && !('k' in x);
  const col = c => {
    if (outside.has(c)) return c;
    if (!map.has(c)) map.set(c, newCol(c.name, c.t, { nn: c.nn, lineage: c.lineage, table: c.table }));
    return map.get(c);
  };
  const walk = x => {
    if (!x || typeof x !== 'object') return x;
    if (Array.isArray(x)) return x.map(walk);
    if (isCol(x)) return col(x);
    if (seen.has(x)) return seen.get(x);
    const out = {};
    seen.set(x, out);
    for (const [k, v] of Object.entries(x)) {
      // A use of a definition reads the definition's own columns.
      out[k] = KEEP.has(k) || (x.k === 'shared' && k === 'picks') ? v : walk(v);
    }
    return out;
  };
  return { rel: walk(rel), map };
}
