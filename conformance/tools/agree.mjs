// dax-sql held to itself, with no Power BI: random queries (fuzz-grammar.mjs, extended) over each
// model and its data, each compiled every way its SQL can be written and run on DuckDB:
//   - compile() (the correlated plan, as DuckDB is given it), and planSql's correlated, unnested
//     and optimized plans: the same rows (rows.mjs), or the same failure;
//   - the T-SQL, Polars and DataFusion SQL: written, or refused with a DaxError;
//   - with DAXSQL_CHECK set, every pass's plan checked (src/check.js);
//   - queries broken on purpose (mutate.mjs): SQL or a DaxError on every dialect.
// A query that disagrees fails the run; it is kept (minimized by hand) as a query of the suite,
// for Power BI to answer.
//   node conformance/tools/agree.mjs [--count 300] [--seed 1] [--mutations 300] [--models a,b] [--report file]
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { engine, value } from '../engines/dax-sql/db.mjs';
import { ROOT, modelDir } from './suite.mjs';
import { CONFIG, generator } from './fuzz-grammar.mjs';
import { mutations } from './mutate.mjs';
import { sameRows, ordered } from './rows.mjs';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : d; };
const COUNT = Number(opt('count', 300)), SEED = Number(opt('seed', 1)), MUTATIONS = Number(opt('mutations', 300));
const MODELS = opt('models', Object.keys(CONFIG).join(',')).split(',');
const MODES = { correlated: { correlated: true }, unnest: { unnest: true }, optimized: {} };
const OTHER = ['tsql', 'polars', 'datafusion'];

const e = await engine(join(ROOT, '..'));
const { DaxError } = await import(new URL('../../src/index.js', import.meta.url));
const failures = [], tally = { queries: 0, answered: 0, refused: 0, failed: 0, mutations: 0 };
const fail = (model, dax, what) => { failures.push({ model, dax, what }); tally.failed++; };
const message = err => `${err.code ? `${err.code}: ` : ''}${err.message.split('\n')[0]}`;

for (const model of MODELS) {
  const db = await e.database(join(modelDir(model), 'model.bim'), join(modelDir(model), 'data'));
  const compilers = new Map();
  const compiler = (roles, dialect = 'duckdb') => {
    const k = `${dialect}|${roles?.join(',') ?? ''}`;
    if (!compilers.has(k)) compilers.set(k, e.createCompiler(db.model, { dialect, columnNames: 'dax', ...(roles ? { roles } : {}) }));
    return compilers.get(k);
  };
  // A way of writing the query's SQL, run: { rows } or { error, dax: whether a DaxError }.
  const run = async write => {
    let sql;
    try { sql = write(); } catch (err) { return { error: message(err), dax: err instanceof DaxError, raw: !(err instanceof DaxError) }; }
    try { return { rows: (await db.con.runAndReadAll(sql)).getRowsJS().map(r => r.map(value)) }; } catch (err) { return { error: `DuckDB: ${err.message.split('\n')[0]}`, engine: true }; }
  };
  const g = generator(model, SEED, { extended: true }), made = [];
  for (let i = 0; i < COUNT; i++) {
    const { dax, roles } = g.query();
    made.push(dax);
    tally.queries++;
    const c = compiler(roles);
    const base = await run(() => c.compile(dax).sql);
    if (base.raw) { fail(model, dax, `compile: ${base.error}`); continue; }
    if (base.dax) tally.refused++; else tally.answered++;
    for (const [mode, o] of Object.entries(MODES)) {
      const a = await run(() => c.planSql(dax, o).sql);
      if (a.raw) fail(model, dax, `${mode}: ${a.error}`);
      else if (base.rows && a.rows && !sameRows(a.rows, base.rows, ordered(dax))) fail(model, dax, `${mode}: other rows than compile's\n  ${mode}: ${JSON.stringify(a.rows).slice(0, 300)}\n  compile: ${JSON.stringify(base.rows).slice(0, 300)}`);
      else if (base.rows && a.error && !a.dax) fail(model, dax, `${mode}: ${a.error} where compile answers`);
      else if (base.error && a.rows) fail(model, dax, `${mode}: rows where compile fails (${base.error})`);
      else if (base.engine && a.error && a.dax) { /* refused here, failed on DuckDB there: both fail */ }
    }
    for (const d of OTHER) {
      try { compiler(roles, d).compile(dax); } catch (err) { if (!(err instanceof DaxError)) fail(model, dax, `${d}: ${message(err)}`); }
    }
  }
  for (const m of mutations(made, MUTATIONS, SEED)) {
    tally.mutations++;
    for (const d of ['duckdb', ...OTHER]) {
      try { compiler(null, d).compile(m.dax); } catch (err) { if (!(err instanceof DaxError)) fail(model, m.dax, `${d}, ${m.how}: ${message(err)}`); }
    }
  }
}

const summary = [
  `### dax-sql against itself (agree.mjs, seed ${SEED})`, '',
  `${tally.queries} random queries over ${MODELS.join(', ')}: ${tally.answered} answered, ${tally.refused} refused (a DaxError), each compiled and run four ways (compile, correlated, unnested, optimized) and written for ${OTHER.join(', ')}; ${tally.mutations} broken on purpose on five dialects. ${failures.length} disagree.`, '',
  ...failures.slice(0, 40).map(f => `- ${f.model}: ${f.what.split('\n')[0]}\n  \`${f.dax.replace(/\s+/g, ' ').slice(0, 300)}\``),
].join('\n');
console.log(summary);
for (const f of failures.slice(0, 40)) console.log(`--- ${f.model}\n${f.dax}\n${f.what}\n`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
if (opt('report')) writeFileSync(opt('report'), JSON.stringify({ seed: SEED, tally, failures }, null, 1));
process.exit(failures.length ? 1 : 0);
