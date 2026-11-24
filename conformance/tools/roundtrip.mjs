// The round trip: every suite query's SQL, for each dialect and the plan its engine is given,
// written from the plan as Substrait read back (planSql) and from the plan itself (planSql
// { ir: true }): the two must be the same text. A difference is a part of the plan the
// Substrait does not carry (substrait.js, substrait-read.js).
//
//   node conformance/tools/roundtrip.mjs [--grep regex] [--show n]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCompiler } from '../../src/index.js';
import { tmslToModel } from '../../formats/tmsl.js';
import { loadQueries, modelDir } from './suite.mjs';

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const grep = opt('grep') && new RegExp(opt('grep'));
const show = Number(opt('show') ?? 5);
const RUNS = [['duckdb', { correlated: true }], ['duckdb', { unnest: true }], ['tsql', { unnest: true }], ['postgres', { unnest: true }], ['postgres', {}], ['polars', { unnest: true }]];
const models = new Map(), compilers = new Map();
const model = m => { if (!models.has(m)) models.set(m, tmslToModel(JSON.parse(readFileSync(join(modelDir(m), 'model.bim'), 'utf8')))); return models.get(m); };
let same = 0, differ = 0, failed = 0, skipped = 0;
const diffs = [], errors = new Map();
for (const q of loadQueries()) {
  const id = `${q.model}/${q.family}/${q.id}`;
  if (grep && !grep.test(id)) continue;
  for (const [dialect, o] of RUNS) {
    const k = `${q.model}|${dialect}|${JSON.stringify(q.roles ?? null)}`;
    if (!compilers.has(k)) compilers.set(k, createCompiler(model(q.model), { dialect, columnNames: 'dax', ...(q.roles ? { roles: q.roles } : {}) }));
    const c = compilers.get(k);
    let a;
    try { a = c.planSql(q.dax, { ...o, ir: true }).sql; } catch { skipped++; continue; }
    try {
      const b = c.planSql(q.dax, o).sql;
      if (a === b) same++;
      else { differ++; diffs.push({ id, dialect, o, a, b }); }
    } catch (err) {
      failed++;
      const m = err.message.split('\n')[0].slice(0, 120);
      errors.set(m, [...(errors.get(m) ?? []), `${id} ${dialect}`]);
    }
  }
}
console.log(`round trip: ${same} the same, ${differ} different, ${failed} failed (${skipped} the plan refuses)`);
for (const [m, ids] of [...errors].sort((x, y) => y[1].length - x[1].length)) console.log(`  failed ${ids.length}: ${m}  (${ids[0]})`);
for (const d of diffs.slice(0, show)) {
  let i = 0;
  while (i < d.a.length && d.a[i] === d.b[i]) i++;
  console.log(`\n${d.id} ${d.dialect} ${JSON.stringify(d.o)} at ${i}:\n  ir:        …${d.a.slice(Math.max(0, i - 120), i + 120)}\n  substrait: …${d.b.slice(Math.max(0, i - 120), i + 120)}`);
}
process.exit(differ || failed ? 1 : 0);
