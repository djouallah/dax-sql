// A check of a query plan's structure (plan.js), for tests and CI: none of it changes a plan.
// With DAXSQL_CHECK set, every pass's plan is checked (index.js, passes/index.js), so a pass that
// breaks one shows where, not as an answer that is wrong later.
//   checkPlan(root, { stage, final })  -> root, or throws an Error naming the stage and the fault
// What it holds a plan to, whatever its passes:
//   - each relation's columns are what its operator makes of its inputs' (a join's the left's
//     then the right's, a window's its input's then its functions', ...);
//   - each column read is one of its relation's inputs', or an enclosing apply's left (the
//     correlated plan), or an enclosing relation's (an EXISTS in its scalars);
//   - no relation has a column twice (so a join of two inputs never has the same column from both:
//     a column is named by its identity, and a rewrite may make one again where it replaces it);
//   - a union reads columns of each branch, as many as it has; a definition's use reads its
//     columns; a definition reads only those before it, and is numbered 1.. in order;
//   - final (after the passes): no DAX operator or function is left in a scalar.
import { kids, scalarsOf } from './passes/decorrelate.js';

const SCALARS_OF_EXPR = x => (x.k === 'op' || x.k === 'fn' || x.k === 'pop') ? x.a ?? []
  : x.k === 'case' ? [...(x.w ?? []).flat(), x.e] : [];

export function checkPlan(root, { stage = 'plan', final = false } = {}) {
  const bad = msg => { throw new Error(`plan check (${stage}): ${msg}`); };
  const where = r => `${r.k}${r.table?.name ? ` ${r.table.name}` : ''}`;
  if (!root || root.k !== 'output') bad(`the root is ${root?.k ?? root}, not output`);
  const defs = root.defs ?? [];
  defs.forEach((d, i) => {
    if (!d || !d.rel) bad(`definition ${i + 1} has no relation`);
  });
  const defAt = new Map(defs.map((d, i) => [d, i]));
  const seen = new Set();    // relations checked (a relation read twice is checked once)

  const makes = (r, cols) => {
    for (const c of cols) {
      if (!c || typeof c !== 'object' || c.id == null) bad(`${where(r)} has a column that is not one`);
    }
  };
  const same = (r, got, want, what) => {
    if (got.length !== want.length || got.some((c, i) => c !== want[i])) {
      bad(`${where(r)}: its columns (${got.map(c => `${c?.name}#${c?.id}`).join(', ')}) are not ${what} (${want.map(c => `${c?.name}#${c?.id}`).join(', ')})`);
    }
  };
  // A scalar: each column it reads in `scope`; an EXISTS's relation checked with scope around it.
  const S = (r, x, scope) => {
    if (!x || typeof x !== 'object') return;
    if (x.k === 'ref') {
      if (!x.col || !scope.has(x.col)) bad(`${where(r)} reads column ${x.col?.name}#${x.col?.id}, which none of its inputs has`);
      return;
    }
    if (final && (x.k === 'op' || x.k === 'fn')) bad(`${where(r)} still has DAX's ${x.k} ${x.op ?? x.name}`);
    if (x.k === 'exists') { R(x.rel, scope); return; }
    for (const y of SCALARS_OF_EXPR(x)) S(r, y, scope);
  };
  // A relation, with `outer` the columns of what encloses it (correlated references).
  const R = (r, outer, def = null) => {
    if (!r || typeof r !== 'object' || !r.k) bad(`a relation that is not one: ${JSON.stringify(r)?.slice(0, 80)}`);
    if (!Array.isArray(r.cols)) bad(`${where(r)} has no columns`);
    if (new Set(r.cols).size !== r.cols.length) bad(`${where(r)} has a column twice`);
    const fresh = !seen.has(r);
    seen.add(r);
    const ks = kids(r);
    if (r.k === 'apply') {
      R(r.left, outer, def);
      R(r.right, new Set([...outer, ...r.left.cols]), def);
    } else ks.forEach(k => R(k, outer, def));
    const input = new Set([...outer, ...ks.flatMap(k => k.cols)]);
    switch (r.k) {
      case 'scan': if (fresh) makes(r, r.cols); break;
      case 'values':
        if (fresh) makes(r, r.cols);
        r.rows.forEach((row, i) => { if (row.length !== r.cols.length) bad(`values: row ${i + 1} has ${row.length} values for ${r.cols.length} columns`); });
        break;
      case 'select': case 'distinct': same(r, r.cols, r.src.cols, 'its input\'s'); break;
      case 'project': if (fresh) makes(r, r.items.map(i => i.col)); same(r, r.cols, r.items.map(i => i.col), 'its items\''); break;
      case 'aggregate':
        if (fresh) makes(r, [...r.keys.map(k => k.col), ...r.aggs.map(a => a.col)]);
        same(r, r.cols, [...r.keys.map(k => k.col), ...r.aggs.map(a => a.col)], 'its keys\' then its aggregates\'');
        break;
      case 'join': case 'apply': same(r, r.cols, [...r.left.cols, ...r.right.cols], 'the left\'s then the right\'s'); break;
      case 'window': if (fresh) makes(r, r.fns.map(f => f.col)); same(r, r.cols, [...r.src.cols, ...r.fns.map(f => f.col)], 'its input\'s then its functions\''); break;
      case 'union':
        if (fresh) makes(r, r.cols);
        if (!r.srcs.length) bad('union of no branch');
        if (r.picks?.length !== r.srcs.length) bad(`union: ${r.picks?.length} picks for ${r.srcs.length} branches`);
        r.picks.forEach((p, i) => {
          if (p.length !== r.cols.length) bad(`union: branch ${i + 1} gives ${p.length} columns for ${r.cols.length}`);
          if (p.some(c => !r.srcs[i].cols.includes(c))) bad(`union: branch ${i + 1} gives a column it does not have`);
        });
        break;
      case 'shared': {
        if (fresh) makes(r, r.cols);
        const at = defAt.get(r.def);
        if (at == null) bad(`a use of a definition the query does not have`);
        if (def != null && at >= def) bad(`definition ${def + 1} reads definition ${at + 1}, which is not before it`);
        if (r.picks?.length !== r.cols.length) bad(`a use of definition ${at + 1}: ${r.picks?.length} picks for ${r.cols.length} columns`);
        if (r.picks.some(c => !r.def.rel.cols.includes(c))) bad(`a use of definition ${at + 1} reads a column it does not have`);
        break;
      }
      case 'series': if (fresh) makes(r, r.cols); break;
      case 'output':
        if (r !== root) bad('an output inside the plan');
        break;
      default: bad(`an operator the plan does not have: ${r.k}`);
    }
    for (const x of scalarsOf(r)) S(r, x, input);
    // A window's and a grouping's scalars are of their input's rows only (with what encloses).
  };
  R(root, new Set());
  defs.forEach((d, i) => R(d.rel, new Set(), i));
  return root;
}

// The check on a pass, when DAXSQL_CHECK is set (off: the pass as it is).
const ON = typeof process !== 'undefined' && !!process.env?.DAXSQL_CHECK;
export const checking = ON;
export function checked(name, pass, { final = false } = {}) {
  if (!ON) return pass;
  return plan => checkPlan(pass(plan), { stage: `after ${name}`, final });
}

// Passes run in order ([[name, pass]]), each checked when DAXSQL_CHECK is set; DAX's operators
// are gone from `standard` on. The plan as lowered is checked first.
export function pipe(steps) {
  const std = steps.findIndex(([n]) => n === 'standard');
  const fs = steps.map(([n, f], i) => checked(n, f, { final: std >= 0 && i >= std }));
  return plan => fs.reduce((p, f) => f(p), ON ? checkPlan(plan, { stage: 'as lowered' }) : plan);
}
