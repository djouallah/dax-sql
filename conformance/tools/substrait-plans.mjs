// Every suite query's query plan as Substrait (substrait.js), the plans every dialect's SQL is
// written from (correlated: DuckDB's; unnested: the other engines'; optimized: planSql's), one
// JSON file each, for substrait_check.py to read against the Substrait specification. Each is
// also read back and written again, and must come back the same (substrait-roundtrip.mjs): a
// plan that does not fails the run.
//
//   node conformance/tools/substrait-plans.mjs <out dir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCompiler } from '../../src/index.js';
import { tmslToModel } from '../../formats/tmsl.js';
import { loadQueries, modelDir } from './suite.mjs';
import { roundTrip, MODES } from './substrait-roundtrip.mjs';

const out = process.argv[2];
mkdirSync(out, { recursive: true });
const compilers = new Map();
let n = 0, refused = 0;
const lost = [];
for (const q of loadQueries()) {
  const k = `${q.model}|${JSON.stringify(q.roles ?? null)}`;
  if (!compilers.has(k)) compilers.set(k, createCompiler(tmslToModel(JSON.parse(readFileSync(join(modelDir(q.model), 'model.bim'), 'utf8'))), { columnNames: 'dax', ...(q.roles ? { roles: q.roles } : {}) }));
  for (const mode of Object.keys(MODES)) {
    let plan;
    try { ({ plan } = compilers.get(k).substrait(q.dax, MODES[mode])); } catch { refused++; continue; }
    writeFileSync(join(out, `${q.model}__${q.family}__${q.id}__${mode}.json`), JSON.stringify(plan));
    n++;
    const diff = roundTrip(compilers.get(k), q.dax, mode);
    if (diff) lost.push(`${q.model}/${q.family}/${q.id} (${mode}): ${diff}`);
  }
}
console.log(`${n} plans written (${refused} queries the plan refuses); ${n - lost.length} of ${n} come back the same from Substrait`);
for (const l of lost) console.log(`::error::the Substrait round trip changes ${l}`);
if (lost.length) process.exit(1);
