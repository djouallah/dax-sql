// The query plan's contract: every query of the suite, optimized and unnested (the correlated
// plan through passes/unnest.js), is made of the plan's simple
// operators only (src/plan.js): no apply, no correlated EXISTS, no DAX operator, function or
// aggregate (src/passes/standard.js writes them all as standard ones, or refuses them), nothing
// else. Writes how many
// queries use each operator, as it is and optimized (to the job summary in CI), and exits 1
// when a plan holds anything else.
//
//   node conformance/engines/dax-sql/operators.mjs <dax-sql checkout>
import { appendFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? '.');
const load = p => import(pathToFileURL(join(root, p)));
const { createCompiler } = await load('src/index.js');
const { tmslToModel } = await load('formats/tmsl.js');
const { free, kids } = await load('src/passes/decorrelate.js');
const { loadQueries, modelDir } = await import(pathToFileURL(join(root, 'conformance', 'tools', 'suite.mjs')));

const RELATIONS = new Set(['scan', 'values', 'select', 'project', 'distinct', 'aggregate', 'join', 'union', 'window', 'series', 'shared', 'output']);
const SCALARS = new Set(['lit', 'op', 'fn', 'case', 'ref', 'exists', 'pop']);
const STANDARD_AGGS = new Set(['sum', 'avg', 'min', 'max', 'count_values', 'count_star', 'count_distinct', 'string_agg', 'median', 'stdev_s', 'stdev_p', 'var_s', 'var_p', 'product']);

// The operators a plan holds, and what it holds that the contract has not.
function operators(plan) {
  const ops = new Set(), bad = new Set(), seen = new Set();
  const walk = x => {
    if (!x || typeof x !== 'object' || seen.has(x)) return;
    seen.add(x);
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (x.columns || x.relationships || x.measures) return;   // the model's own objects
    if (typeof x.k === 'string') {
      if (RELATIONS.has(x.k)) ops.add(x.k === 'join' ? `join (${x.kind})` : x.k);
      else if (x.k === 'exists') {
        const name = free(x.rel).size ? 'exists (correlated)' : 'exists';
        ops.add(name);
        if (free(x.rel).size) bad.add(name);
      } else if (SCALARS.has(x.k)) {
        // The plan's standard operators by name; DAX's that are left (no standard writing yet).
        if (x.k === 'pop') ops.add(x.op === 'call' ? `fn ${x.name}` : `op ${x.op}`);
        else if (x.k === 'fn') { ops.add(`DAX fn ${x.name}`); bad.add(`DAX fn ${x.name}`); }
        else if (x.k === 'op') { ops.add(`DAX op ${x.op}`); bad.add(`DAX op ${x.op}`); }
      } else { ops.add(x.k); bad.add(x.k); }
      if (x.k === 'aggregate') for (const a of x.aggs) {
        ops.add(STANDARD_AGGS.has(a.fn) ? `agg ${a.fn}` : `DAX agg ${a.fn}`);
        if (!STANDARD_AGGS.has(a.fn)) bad.add(`DAX agg ${a.fn}`);
      }
    }
    for (const [k, v] of Object.entries(x)) if (k !== 'lineage' && k !== 'table') walk(v);
  };
  walk(plan);
  return { ops, bad };
}

// Joins that can multiply rows: a cross join, or a join whose condition has no equality between
// a column of each side, neither side of one row. Decorrelation's general path leaves them (D
// crossed with the rows it is pushed into): their size is the product of the sides', growing as
// the data does (m distinct values by n rows). One per such join of the plan, its definitions
// counted once.
function unbounded(plan) {
  const one = new Map();
  const oneRow = r => {
    if (one.has(r)) return one.get(r);
    let v = false;
    if (r.k === 'aggregate') v = !r.keys.length;
    else if (r.k === 'values') v = r.rows.length <= 1;
    else if (r.k === 'shared') v = oneRow(r.def.rel);
    else if (r.k === 'project' || r.k === 'select' || r.k === 'distinct' || r.k === 'window') v = oneRow(r.src);
    else if (r.k === 'join') v = oneRow(r.left) && oneRow(r.right);
    one.set(r, v);
    return v;
  };
  const conjuncts = x => (x && x.k === 'pop' && x.op === 'and' ? x.a.flatMap(conjuncts) : x ? [x] : []);
  const refs = (x, out = new Set()) => { if (!x || typeof x !== 'object') return out; if (x.k === 'ref') out.add(x.col); if (x.k === 'case') { x.w.forEach(([a, b]) => { refs(a, out); refs(b, out); }); refs(x.e, out); } if (Array.isArray(x.a)) x.a.forEach(y => refs(y, out)); return out; };
  const keyed = j => {
    const L = new Set(j.left.cols), R = new Set(j.right.cols);
    const side = (x, S) => { const f = refs(x); return f.size > 0 && [...f].every(c => S.has(c)); };
    return conjuncts(j.on).some(c => c.k === 'pop' && (c.op === 'eq' || c.op === 'key') && ((side(c.a[0], L) && side(c.a[1], R)) || (side(c.a[0], R) && side(c.a[1], L))));
  };
  const n = { cross: 0, range: 0 };
  const seen = new Set();
  const walk = r => {
    if (seen.has(r)) return;
    seen.add(r);
    if (r.k === 'join' && !oneRow(r.left) && !oneRow(r.right) && (r.kind === 'cross' || !keyed(r))) n[r.kind === 'cross' || !r.on || (r.on.k === 'pop' && r.on.op === 'true') ? 'cross' : 'range']++;
    kids(r).forEach(walk);
  };
  walk(plan.src);
  (plan.defs ?? []).forEach(d => walk(d.rel));
  return n;
}

const compilers = new Map();
const multiplying = [], multiplyingU = [];
const counts = { raw: new Map(), opt: new Map(), unnest: new Map() };
const broken = [];
let planned = 0, refused = 0;
for (const q of loadQueries({})) {
  const key = `${q.model}|${JSON.stringify(q.roles ?? null)}`;
  if (!compilers.has(key)) {
    const bim = JSON.parse(readFileSync(join(modelDir(q.model), 'model.bim'), 'utf8'));
    compilers.set(key, createCompiler(tmslToModel(bim), q.roles ? { roles: q.roles } : {}));
  }
  let raw, opt;
  try {
    raw = compilers.get(key).plan(q.dax, { optimize: false });
    opt = compilers.get(key).plan(q.dax, { optimize: true });
  } catch { refused++; continue; }   // a DAX error, as compile gives
  planned++;
  // The correlated plan unnested (passes/unnest.js): the same contract.
  let un;
  try { un = compilers.get(key).plan(q.dax, { unnest: true }); } catch (err) { broken.push(`unnest ${q.model}/${q.family}/${q.id}: ${err.message.split('\n')[0]}`); }
  for (const [mode, p] of [['raw', raw], ['opt', opt], ['unnest', un]]) {
    if (!p) continue;
    const { ops, bad } = operators(p);
    for (const o of ops) counts[mode].set(o, (counts[mode].get(o) ?? 0) + 1);
    if (mode !== 'raw' && bad.size) broken.push(`${mode === 'unnest' ? 'unnest ' : ''}${q.model}/${q.family}/${q.id}: ${[...bad].join(', ')}`);
  }
  const u = unbounded(opt);
  if (u.cross + u.range) multiplying.push({ id: `${q.model}/${q.family}/${q.id}`, n: u.cross + u.range, ...u });
  const v = un ? unbounded(un) : { cross: 0, range: 0 };
  if (v.cross + v.range) multiplyingU.push({ id: `${q.model}/${q.family}/${q.id}`, n: v.cross + v.range, ...v });
}

const names = [...new Set([...counts.raw.keys(), ...counts.opt.keys(), ...counts.unnest.keys()])].sort();
const table = `### The query plan's operators\n\n${planned} queries planned (${refused} refused: DAX errors).\n\n| operator | queries, as it is | optimized | unnested |\n|---|---|---|---|\n`
  + names.map(n => `| ${n} | ${counts.raw.get(n) ?? 0} | ${counts.opt.get(n) ?? 0} | ${counts.unnest.get(n) ?? 0} |`).join('\n')
  + `\n\n**Joins that can multiply rows** (a cross join, or no equality between the sides; neither side of one row): ${multiplying.reduce((a, m) => a + m.cross, 0)} cross joins and ${multiplying.reduce((a, m) => a + m.range, 0)} joins on other conditions (ranges), in ${multiplying.length} queries.\n\n`
  + multiplying.sort((a, b) => b.n - a.n).slice(0, 40).map(m => `- ${m.id}: ${m.cross} cross, ${m.range} other`).join('\n') + '\n'
  + `\n**Unnested** (passes/unnest.js): ${multiplyingU.reduce((a, m) => a + m.cross, 0)} cross joins and ${multiplyingU.reduce((a, m) => a + m.range, 0)} joins on other conditions, in ${multiplyingU.length} queries.\n\n`
  + multiplyingU.sort((a, b) => b.n - a.n).slice(0, 40).map(m => `- ${m.id}: ${m.cross} cross, ${m.range} other`).join('\n') + '\n'
  + (broken.length ? `\n\n**Outside the contract (${broken.length}):**\n\n${broken.slice(0, 30).map(b => `- ${b}`).join('\n')}\n` : '\n');
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);
process.exit(broken.length ? 1 : 0);
