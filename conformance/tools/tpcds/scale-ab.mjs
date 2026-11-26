// Two checkouts' SQL for the tpcds queries timed on one machine, one query's two SQLs in turn (the
// head's, the base's, the head's again), so a change is held to the same runner's speed: across
// two runs of scale.yml a runner can be a third slower or faster.
//   node tools/tpcds/scale-ab.mjs <sf.duckdb> <base checkout> [--head <checkout>] [--grep regex] [--timeout 120] [--report out.json]
// --head: the head's checkout (by default this one).
// Each query: both compiled; the same SQL is not run again (no change); otherwise each run twice,
// interleaved (head, base, head, base), its time the faster of its two. Answers are compared.
// A measure, not a gate: it exits 0.
import { appendFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i < 0 ? d : args.splice(i, 2)[1]; };
const timeout = Number(opt('--timeout', 120)) * 1000;
const grep = opt('--grep', null);
const report = opt('--report', null);
const headOpt = opt('--head', null);
const [file, baseDir] = args;
if (!file || !baseDir) throw new Error('usage: scale-ab.mjs <sf.duckdb> <base checkout> [--grep regex]');

const headDir = resolve(headOpt ?? new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const load = async dir => {
  const { engine, value } = await import(pathToFileURL(join(dir, 'conformance/engines/dax-sql/db.mjs')).href);
  const { loadQueries, modelDir } = await import(pathToFileURL(join(dir, 'conformance/tools/suite.mjs')).href);
  return { e: await engine(dir), value, loadQueries, modelDir };
};
const H = await load(headDir), B = await load(resolve(baseDir));
const require = createRequire(join(headDir, 'package.json'));
const { DuckDBInstance, JSDuckDBValueConverter } = require('@duckdb/node-api');
const inst = await DuckDBInstance.create(file, { access_mode: 'READ_ONLY' });
let con = await inst.connect();
const compilerOf = async X => {
  const db = await X.e.database(join(X.modelDir('tpcds'), 'model.bim'), null, con);
  return X.e.createCompiler(db.model, { columnNames: 'dax' });
};
const hc = await compilerOf(H), bc = await compilerOf(B);

async function run(sql) {
  const timer = setTimeout(() => con.interrupt(), timeout);
  const t0 = performance.now();
  let open = true;
  try {
    let rows = [];
    const result = await con.stream(sql);
    for (let ch; (ch = await result.fetchChunk()) && ch.rowCount;) {
      const cols = ch.convertColumns(JSDuckDBValueConverter);
      for (let i = 0; i < ch.rowCount; i++) rows.push(cols.map(c => H.value(c[i])));
      if (rows.length > 100000) { rows = null; break; }
    }
    open = !rows;
    return { ms: Math.round(performance.now() - t0), rows };
  } catch (err) {
    const ms = performance.now() - t0;
    return { ms: Math.round(ms), error: ms >= timeout - 50 ? `timeout (${timeout / 1000} s)` : err.message.split('\n')[0] };
  } finally {
    clearTimeout(timer);
    if (open) con = await inst.connect();
  }
}
const norm = rows => rows.map(r => JSON.stringify(r.map(v => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toPrecision(9)) : v)))).sort();
const same = (a, b) => { if (!a || !b) return null; const x = norm(a), y = norm(b); return x.length === y.length && x.every((r, i) => r === y[i]); };

const queries = H.loadQueries({ model: 'tpcds' }).filter(q => !grep || new RegExp(grep).test(`${q.family}/${q.id}`));
const results = [];
for (const q of queries) {
  const id = `${q.family}/${q.id}`;
  let hs, bs;
  try { hs = hc.compile(q.dax).sql; bs = bc.compile(q.dax).sql; } catch { continue; }
  if (hs === bs) continue;
  const h1 = await run(hs), b1 = await run(bs), h2 = await run(hs), b2 = await run(bs);
  const r = { id, head: Math.min(h1.ms, h2.ms), base: Math.min(b1.ms, b2.ms) };
  if (h1.error || b1.error) r.error = h1.error ?? b1.error;
  else r.answer = same(h1.rows, b1.rows) === false ? 'differs' : 'same';
  results.push(r);
}

const ok = results.filter(r => !r.error);
const sum = k => ok.reduce((s, r) => s + r[k], 0);
const line = r => `| ${r.id} | ${r.base} | ${r.head} | ${(r.head / Math.max(r.base, 1)).toFixed(2)} | ${r.error ?? r.answer} |`;
const head = '| query | base ms | head ms | × base | |\n|---|---|---|---|---|';
const by = [...ok].sort((a, b) => (b.head - b.base) - (a.head - a.base));
const summary = [
  `### The head's SQL against the base's, on one runner: ${results.length} queries whose SQL differs`, '',
  `base ${(sum('base') / 1000).toFixed(1)} s, head ${(sum('head') / 1000).toFixed(1)} s; answers otherwise: ${ok.filter(r => r.answer === 'differs').length}; errors: ${results.length - ok.length}.`, '',
  '#### The most slowed', '', head, ...by.slice(0, 15).map(line), '',
  '#### The most sped up', '', head, ...by.slice(-15).reverse().map(line), '',
  ...(results.some(r => r.error || r.answer === 'differs') ? ['#### Errors and answers otherwise', '', head, ...results.filter(r => r.error || r.answer === 'differs').map(line), ''] : []),
].join('\n');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
if (report) writeFileSync(report, JSON.stringify(results, null, 1));
