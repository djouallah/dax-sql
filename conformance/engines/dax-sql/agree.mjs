// Every query of the suite compiled twice by one dax-sql checkout, with the emitter's rewrites
// (fusion, shared scans, the rest) and without (optimize: false, each aggregate its own
// subquery as the filter context says it), run on the same DuckDB: the rows must be the same.
// It holds the rewrites to the plain SQL on every query, the known ones too, whatever Power BI
// answers: .github/workflows/conformance.yml.
//   node engines/dax-sql/agree.mjs <dax-sql checkout> [--grep regex]
// Rows are compared as a multiset; numbers equal within 1e-9 of their size (two SQLs add up
// floating-point values in their own order); an error must be the same error.
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadQueries, modelDir } from '../../tools/suite.mjs';
import { engine, value } from './db.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--grep');
const grep = at >= 0 ? new RegExp(args[at + 1]) : null;
const e = await engine(args[0] ?? '.');

const queries = loadQueries({}).map(q => ({ ...q, key: `${q.model}/${q.family}/${q.id}` })).filter(q => !grep || grep.test(q.key));
const dbs = new Map();
const near = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)) : a === b);
const canon = r => JSON.stringify(r.map(v => (typeof v === 'number' ? Number(v.toPrecision(9)) : v)));
function same(a, b) {
  if (a.length !== b.length) return `${a.length} rows, not ${b.length}`;
  const left = [...b].sort((x, y) => (canon(x) < canon(y) ? -1 : 1));
  const got = [...a].sort((x, y) => (canon(x) < canon(y) ? -1 : 1));
  for (let i = 0; i < got.length; i++) {
    if (got[i].length !== left[i].length || got[i].some((v, j) => !near(v, left[i][j]))) return `row ${JSON.stringify(got[i])}, not ${JSON.stringify(left[i])}`;
  }
  return null;
}

async function answer(db, q, optimize) {
  const k = `${JSON.stringify(q.roles ?? null)}|${optimize}`;
  if (!db.compilers.has(k)) db.compilers.set(k, e.createCompiler(db.model, { columnNames: 'dax', optimize, ...(q.roles ? { roles: q.roles } : {}) }));
  try {
    const { sql } = db.compilers.get(k).compile(q.dax);
    return { rows: (await db.con.runAndReadAll(sql)).getRowsJS().map(r => r.map(value)) };
  } catch (err) {
    return { error: err.message.split('\n')[0] };
  }
}

const bad = [];
for (const q of queries) {
  const dir = modelDir(q.model);
  if (!dbs.has(dir)) dbs.set(dir, { ...(await e.database(resolve(dir, 'model.bim'), resolve(dir, 'data'))), compilers: new Map() });
  const db = dbs.get(dir);
  const [fused, plain] = [await answer(db, q, true), await answer(db, q, false)];
  const why = fused.error || plain.error
    ? (fused.error === plain.error ? null : `optimized: ${fused.error ?? 'rows'}; plain: ${plain.error ?? 'rows'}`)
    : same(fused.rows, plain.rows);
  if (why) bad.push(`${q.key}: ${why}`);
}
const line = `### The emitter's rewrites against the plain SQL: ${queries.length - bad.length} of ${queries.length} queries agree`;
console.log(line);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
for (const b of bad) console.log(`::error::${b.slice(0, 1500)}`);
process.exit(bad.length ? 1 : 0);
