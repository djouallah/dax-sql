// The time of every query of the suite (compiling it and running its SQL on DuckDB), by two
// dax-sql checkouts, a base and a head, on the same machine and the same DuckDB: a head that is
// slower fails. .github/workflows/perf.yml runs it on each push against the commit before.
//   node engines/dax-sql/bench.mjs <base checkout> <head checkout> [--rounds 3] [--grep regex]
// Each round times every query by both, the order alternating; a query's time is its fastest
// round, the least noise. The head fails when the whole suite is more than 10% slower, or a
// query takes more than twice as long and 250 ms more. The slowest changes are in the report.
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadQueries, modelDir } from '../../tools/suite.mjs';
import { engine } from './db.mjs';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i < 0 ? d : args.splice(i, 2)[1]; };
const rounds = Number(opt('--rounds', 3));
const grep = opt('--grep', null);
const [baseDir, headDir] = args;
if (!baseDir || !headDir) throw new Error('usage: bench.mjs <base checkout> <head checkout> [--rounds 3] [--grep regex]');
const TOTAL = 1.10, QUERY = 2, MS = 250;

const head = await engine(headDir);
const base = await engine(baseDir, { DuckDBInstance: head.DuckDBInstance });
const queries = loadQueries({}).map(q => ({ ...q, key: `${q.model}/${q.family}/${q.id}` })).filter(q => !grep || new RegExp(grep).test(q.key));

// One DuckDB per model, loaded once by the head; the base reads its model from the same file.
const dbs = new Map();
async function dbOf(q) {
  const dir = modelDir(q.model);
  if (!dbs.has(dir)) {
    const h = await head.database(resolve(dir, 'model.bim'), resolve(dir, 'data'));
    const b = await base.database(resolve(dir, 'model.bim'), resolve(dir, 'data'), h.con);
    dbs.set(dir, { con: h.con, models: { head: h.model, base: b.model }, compilers: new Map() });
  }
  return dbs.get(dir);
}
async function time(side, e, q) {
  const db = await dbOf(q);
  const k = `${side}|${JSON.stringify(q.roles ?? null)}`;
  if (!db.compilers.has(k)) db.compilers.set(k, e.createCompiler(db.models[side], { columnNames: 'dax', ...(q.roles ? { roles: q.roles } : {}) }));
  const t0 = performance.now();
  try {
    await db.con.runAndReadAll(db.compilers.get(k).compile(q.dax).sql);
  } catch {
    return null;
  }
  return performance.now() - t0;
}

const best = new Map(queries.map(q => [q.key, { base: Infinity, head: Infinity, failed: false }]));
for (let r = 0; r < rounds; r++) {
  for (const q of queries) {
    const b = best.get(q.key);
    const order = r % 2 ? [['head', head], ['base', base]] : [['base', base], ['head', head]];
    for (const [side, e] of order) {
      const t = await time(side, e, q);
      if (t == null) b.failed = true;
      else b[side] = Math.min(b[side], t);
    }
  }
}

const timed = [...best].filter(([, b]) => !b.failed && Number.isFinite(b.base) && Number.isFinite(b.head));
const sum = side => timed.reduce((n, [, b]) => n + b[side], 0);
const [tb, th] = [sum('base'), sum('head')];
const slower = timed.filter(([, b]) => b.head > QUERY * b.base && b.head - b.base > MS);
const bad = [];
if (th > TOTAL * tb) bad.push(`the suite takes ${(th / 1000).toFixed(1)} s, ${((th / tb - 1) * 100).toFixed(0)}% more than ${(tb / 1000).toFixed(1)} s`);
for (const [k, b] of slower) bad.push(`${k}: ${b.head.toFixed(0)} ms, ${(b.head / b.base).toFixed(1)}x ${b.base.toFixed(0)} ms`);

const ms = v => v.toFixed(0);
const top = [...timed].sort((x, y) => (y[1].head - y[1].base) - (x[1].head - x[1].base)).slice(0, 10);
const gain = [...timed].sort((x, y) => (x[1].head - x[1].base) - (y[1].head - y[1].base)).slice(0, 5);
const summary = [
  `### Speed against the commit before: ${(th / 1000).toFixed(1)} s, was ${(tb / 1000).toFixed(1)} s (${th >= tb ? '+' : ''}${((th / tb - 1) * 100).toFixed(1)}%), ${timed.length} queries, fastest of ${rounds} rounds`, '',
  '| query | before, ms | now, ms |', '|---|---|---|',
  ...top.map(([k, b]) => `| ${k} | ${ms(b.base)} | ${ms(b.head)} |`),
  ...gain.map(([k, b]) => `| ${k} | ${ms(b.base)} | ${ms(b.head)} |`), '',
].join('\n');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
for (const b of bad) console.log(`::error::slower: ${b}`);
process.exit(bad.length ? 1 : 0);
