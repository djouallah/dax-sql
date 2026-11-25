// Every tpcds query of the suite on the model's tables at a TPC-DS scale factor (a DuckDB file
// tools/tpcds/scale.mjs writes): each compiled by this checkout and run on DuckDB, timed, and its
// answer held to the same query through the plan unnested (passes/unnest.js: no correlated
// subquery left), a second SQL of the same plan that DuckDB runs another way.
//   node tools/tpcds/scale-run.mjs <sf.duckdb> [--timeout 120] [--grep regex] [--no-agree] [--report out.json] [--gate]
//   [--answers out.json] [--max-rows 100000]
// --answers: each query's answer as a count of rows and a hash of them (as norm() writes them), for
// another engine's to be held to (tools/tpcds/scale-engine.mjs).
// --gate (.github/workflows/scale.yml, a release gate): fails when a query fails or times out on
// DuckDB, or the compiler refuses one that Power BI answers (golden/tpcds).
// A query past the timeout is interrupted. The report lists the slowest queries, those that
// error, and those whose two answers differ.
import { appendFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { loadQueries, loadGoldens, modelDir } from '../suite.mjs';
import { engine, value } from '../../engines/dax-sql/db.mjs';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i < 0 ? d : args.splice(i, 2)[1]; };
const flag = name => { const i = args.indexOf(name); return i >= 0 && !!args.splice(i, 1); };
const timeout = Number(opt('--timeout', 120)) * 1000;
const grep = opt('--grep', null);
const report = opt('--report', null);
const agree = !flag('--no-agree');
const maxRows = Number(opt('--max-rows', 100000));
const gate = flag('--gate');
const answersFile = opt('--answers', null);
const answers = {};
const [file] = args;
if (!file) throw new Error('usage: scale-run.mjs <sf.duckdb> [--timeout 120] [--grep regex] [--no-agree] [--report out.json]');

const root = new URL('../../../', import.meta.url);
const e = await engine(root.pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(new URL('package.json', root));
const { DuckDBInstance, JSDuckDBValueConverter } = require('@duckdb/node-api');
const con = await (await DuckDBInstance.create(file, { access_mode: 'READ_ONLY' })).connect();
const db = await e.database(join(modelDir('tpcds'), 'model.bim'), null, con);
const compilers = new Map();
const compiler = roles => {
  const k = JSON.stringify(roles);
  if (!compilers.has(k)) compilers.set(k, e.createCompiler(db.model, { columnNames: 'dax', ...(roles ? { roles } : {}) }));
  return compilers.get(k);
};

// A query's answer streamed: its rows counted, kept while there are --max-rows at most (at SF10 an
// answer of 28 million rows is no answer to hold in memory, nor one another engine is held to).
async function run(sql) {
  const timer = setTimeout(() => con.interrupt(), timeout);
  const t0 = performance.now();
  try {
    const result = await con.stream(sql);
    let n = 0, rows = [];
    for (let ch; (ch = await result.fetchChunk()) && ch.rowCount;) {
      n += ch.rowCount;
      if (n > maxRows) { rows = null; continue; }
      const cols = ch.convertColumns(JSDuckDBValueConverter);
      for (let i = 0; i < ch.rowCount; i++) rows.push(cols.map(c => value(c[i])));
    }
    return { ms: performance.now() - t0, n, rows };
  } catch (err) {
    const ms = performance.now() - t0;
    return { ms, error: ms >= timeout - 50 ? `timeout (${timeout / 1000} s)` : err.message.split('\n')[0] };
  } finally { clearTimeout(timer); }
}
// Two answers the same as bags of rows, numbers to 9 significant digits (a sum's order of adding).
const norm = rows => rows.map(r => JSON.stringify(r.map(v => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toPrecision(9)) : v)))).sort();
const same = (a, b) => { const x = norm(a), y = norm(b); return x.length === y.length && x.every((r, i) => r === y[i]); };

const queries = loadQueries({ model: 'tpcds' }).filter(q => !grep || new RegExp(grep).test(`${q.family}/${q.id}`));
const results = [];
const t0 = performance.now();
for (const q of queries) {
  const r = { id: `${q.family}/${q.id}` };
  results.push(r);
  let sql;
  try { sql = compiler(q.roles).compile(q.dax).sql; } catch (err) { r.compileError = `${err.code ? `${err.code}: ` : ''}${err.message.split('\n')[0]}`; continue; }
  const a = await run(sql);
  r.ms = Math.round(a.ms); r.bytes = sql.length;
  if (a.error) { r.error = a.error; console.log(`error ${r.id}: ${a.error}`); continue; }
  r.rows = a.n;
  if (answersFile && a.rows) answers[r.id] = { rows: a.n, hash: createHash('sha1').update(norm(a.rows).join('\n')).digest('hex') };
  if (r.ms > 2000) console.log(`slow ${r.id}: ${r.ms} ms`);
  if (agree) {
    const b = await run(compiler(q.roles).planSql(q.dax, { unnest: true }).sql);
    r.unnestMs = Math.round(b.ms);
    if (b.error) r.unnestError = b.error;
    else if (a.rows && b.rows && !same(a.rows, b.rows)) r.differs = true;
  }
  if (results.length % 100 === 0) console.log(`… ${results.length}/${queries.length}, ${((performance.now() - t0) / 1000).toFixed(0)} s`);
}

const ran = results.filter(r => r.ms != null && !r.error);
const total = ran.reduce((s, r) => s + r.ms, 0);
const pct = p => { const v = ran.map(r => r.ms).sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : 0; };
const line = r => `| ${r.id} | ${r.ms ?? ''} | ${r.unnestMs ?? ''} | ${r.rows ?? ''} | ${(r.compileError ?? r.error ?? r.unnestError ?? (r.differs ? 'the two answers differ' : '')).replaceAll('|', '\\|').slice(0, 160)} |`;
const bad = results.filter(r => r.compileError || r.error || r.unnestError || r.differs);
const head = '| query | ms | unnested ms | rows | |\n|---|---|---|---|---|';
const summary = [
  `### tpcds at scale (${file.replace(/\\/g, '/').split('/').pop()}): ${queries.length} queries`, '',
  `${ran.length} ran in ${(total / 1000).toFixed(1)} s (median ${pct(0.5)} ms, p90 ${pct(0.9)} ms, p99 ${pct(0.99)} ms, max ${pct(1)} ms); `
    + `${results.filter(r => r.compileError).length} refused by the compiler, ${results.filter(r => r.error).length} failed or timed out on DuckDB`
    + (agree ? `, ${results.filter(r => r.differs).length} answer otherwise unnested, ${results.filter(r => r.unnestError).length} fail unnested` : ''), '',
  '#### The slowest 25', '', head, ...[...ran].sort((a, b) => b.ms - a.ms).slice(0, 25).map(line), '',
  ...(bad.length ? ['#### Errors and disagreements', '', head, ...bad.map(line), ''] : []),
].join('\n');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
if (report) writeFileSync(report, JSON.stringify(results, null, 1));
if (answersFile) writeFileSync(answersFile, JSON.stringify(answers));
if (gate) {
  const goldens = new Map();
  const golden = id => { const [family, q] = id.split('/'); if (!goldens.has(family)) goldens.set(family, loadGoldens('tpcds', family)); return goldens.get(family)[q]; };
  const failed = results.filter(r => r.error || r.unnestError || r.differs || (r.compileError && !golden(r.id)?.error));
  for (const r of failed) console.log(`::error::${r.id}: ${r.error ?? r.unnestError ?? (r.differs ? 'the two answers differ' : `refused, Power BI answers it: ${r.compileError}`)}`);
  process.exit(failed.length ? 1 : 0);
}
