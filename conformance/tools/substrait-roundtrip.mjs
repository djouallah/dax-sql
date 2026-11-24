// The Substrait round trip, checked: a query's plan written as Substrait (substrait.js), read
// back (substrait-read.js, as every dialect's SQL is) and written again must be the same plan.
// What may differ is only what names a column for a reader: the hints (common.hint, the
// columns' names with their ids) and a virtual table's column names (c<id>), ids being the
// process's; every other field, nullability and type included, must come back as it went.
//   roundTrip(compiler, dax, mode) -> null, or where the second plan differs from the first
import { toSubstrait } from '../../src/substrait.js';
import { readSubstrait } from '../../src/substrait-read.js';

export const MODES = { correlated: { correlated: true }, unnest: { unnest: true }, optimized: {} };

// A plan with what names its columns for a reader left out, and its ids numbered in order.
function canon(x) {
  const ids = new Map();
  const id = k => { if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k); };
  const w = v => (typeof v === 'string' ? v.replace(/^c\d+$/, 'c').replace(/#(\d+)/g, (_, d) => `#${id(d)}`)
    : Array.isArray(v) ? v.map(w)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'hint').map(([k, y]) => [k, w(y)])) : v);
  return w(x);
}
function firstDiff(a, b, path = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDiff(a[k], b[k], `${path}.${k}`);
      if (d) return d;
    }
  }
  return `${path}: ${JSON.stringify(a)?.slice(0, 120)} became ${JSON.stringify(b)?.slice(0, 120)}`;
}

// The compiler's plan for `dax` in `mode` (MODES), and the plan it comes back as.
export function roundTrip(compiler, dax, mode, options = {}) {
  const s = compiler.substrait(dax, MODES[mode]);
  const once = JSON.parse(JSON.stringify(s.plan));
  const back = readSubstrait(JSON.parse(JSON.stringify(once)), compiler.model, { columns: s.columns, castOutput: options.castOutput });
  const twice = JSON.parse(JSON.stringify(toSubstrait(back).plan));
  return firstDiff(canon(once), canon(twice));
}
