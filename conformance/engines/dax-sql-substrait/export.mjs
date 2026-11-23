// Every suite query's optimized query plan as Substrait, as substrait.js writes it (a definition
// read in several places a plan relation, read by ReferenceRel): <out>/<model>/<family>/<id>.json,
// and <out>/dax.json: the dax-sql functions each plan uses. For the validator (validate.py).
//
//   node conformance/engines/dax-sql-substrait/export.mjs <dax-sql checkout> <out>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? '.'), out = resolve(process.argv[3] ?? 'substrait-plans');
const load = p => import(pathToFileURL(join(root, p)));
const { createCompiler } = await load('src/index.js');
const { tmslToModel } = await load('formats/tmsl.js');
const { loadQueries, modelDir } = await import(pathToFileURL(join(root, 'conformance', 'tools', 'suite.mjs')));

const compilers = new Map(), dax = {}, refused = {};
let written = 0;
for (const q of loadQueries({})) {
  const key = `${q.model}|${JSON.stringify(q.roles ?? null)}`;
  if (!compilers.has(key)) {
    const bim = JSON.parse(readFileSync(join(modelDir(q.model), 'model.bim'), 'utf8'));
    compilers.set(key, createCompiler(tmslToModel(bim), q.roles ? { roles: q.roles } : {}));
  }
  const id = `${q.model}/${q.family}/${q.id}`;
  try {
    const { plan, dax: fns } = compilers.get(key).substrait(q.dax);
    const file = join(out, `${id}.json`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(plan));
    dax[id] = fns;
    written++;
  } catch (err) {
    refused[id] = `${err.code ? `${err.code}: ` : ''}${err.message.split('\n')[0]}`;
  }
}
writeFileSync(join(out, 'dax.json'), JSON.stringify(dax, null, 1));
writeFileSync(join(out, 'refused.json'), JSON.stringify(refused, null, 1));
console.log(`${written} plans written, ${Object.keys(refused).length} refused (a DAX error, or what Substrait cannot hold)`);
