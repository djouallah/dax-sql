// The query plan's contract: every query of the suite, optimized, is made of the plan's simple
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
const { free } = await load('src/passes/decorrelate.js');
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

const compilers = new Map();
const counts = { raw: new Map(), opt: new Map() };
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
  for (const [mode, p] of [['raw', raw], ['opt', opt]]) {
    const { ops, bad } = operators(p);
    for (const o of ops) counts[mode].set(o, (counts[mode].get(o) ?? 0) + 1);
    if (mode === 'opt' && bad.size) broken.push(`${q.model}/${q.family}/${q.id}: ${[...bad].join(', ')}`);
  }
}

const names = [...new Set([...counts.raw.keys(), ...counts.opt.keys()])].sort();
const table = `### The query plan's operators\n\n${planned} queries planned (${refused} refused: DAX errors).\n\n| operator | queries, as it is | optimized |\n|---|---|---|\n`
  + names.map(n => `| ${n} | ${counts.raw.get(n) ?? 0} | ${counts.opt.get(n) ?? 0} |`).join('\n')
  + (broken.length ? `\n\n**Outside the contract (${broken.length}):**\n\n${broken.slice(0, 30).map(b => `- ${b}`).join('\n')}\n` : '\n');
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);
process.exit(broken.length ? 1 : 0);
