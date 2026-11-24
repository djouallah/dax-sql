// Every suite query's query plan as Substrait (substrait.js), the plans every dialect's SQL is
// written from (correlated: DuckDB's; unnested: the other engines'), one JSON file each, for
// substrait_check.py to read against the Substrait specification.
//
//   node conformance/tools/substrait-plans.mjs <out dir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCompiler } from '../../src/index.js';
import { tmslToModel } from '../../formats/tmsl.js';
import { loadQueries, modelDir } from './suite.mjs';

const out = process.argv[2];
mkdirSync(out, { recursive: true });
const compilers = new Map();
let n = 0, refused = 0;
for (const q of loadQueries()) {
  const k = `${q.model}|${JSON.stringify(q.roles ?? null)}`;
  if (!compilers.has(k)) compilers.set(k, createCompiler(tmslToModel(JSON.parse(readFileSync(join(modelDir(q.model), 'model.bim'), 'utf8'))), { columnNames: 'dax', ...(q.roles ? { roles: q.roles } : {}) }));
  for (const mode of ['correlated', 'unnest']) {
    let plan;
    try { ({ plan } = compilers.get(k).substrait(q.dax, { [mode]: true })); } catch { refused++; continue; }
    writeFileSync(join(out, `${q.model}__${q.family}__${q.id}__${mode}.json`), JSON.stringify(plan));
    n++;
  }
}
console.log(`${n} plans written (${refused} queries the plan refuses)`);
