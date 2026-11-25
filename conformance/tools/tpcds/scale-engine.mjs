// The tpcds queries at a TPC-DS scale factor on another engine, through its adapter (as the
// conformance runner gives it a request: engines/<engine>/adapter.mjs), each answer held to
// DuckDB's at the same scale (tools/tpcds/scale-run.mjs --answers) and timed (DAXSQL_TIMES).
//   node tools/tpcds/scale-engine.mjs --adapter "<command>" --model-dir <dir> --answers <duckdb.json>
//     [--label Polars] [--max-rows 100000] [--report out.json]
// <dir>: the tables as a model folder (tools/tpcds/scale.mjs --model-dir). A query whose answer
// on DuckDB has more than --max-rows rows is left out (millions of rows written as JSON lines
// measure the writing, not the engine). A measure, not a gate: it exits 0.
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadQueries } from '../suite.mjs';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i < 0 ? d : args.splice(i, 2)[1]; };
const adapter = opt('--adapter', null), modelDir = opt('--model-dir', null), answersFile = opt('--answers', null);
const grep = opt('--grep', null);
const label = opt('--label', 'the engine'), maxRows = Number(opt('--max-rows', 100000)), report = opt('--report', null);
if (!adapter || !modelDir || !answersFile) throw new Error('usage: scale-engine.mjs --adapter "<command>" --model-dir <dir> --answers <duckdb.json>');

const duck = JSON.parse(readFileSync(answersFile, 'utf8'));
const queries = loadQueries({ model: 'tpcds' }).map(q => ({ ...q, key: `${q.family}/${q.id}` }));
const asked = queries.filter(q => duck[q.key] && duck[q.key].rows <= maxRows && (!grep || new RegExp(grep).test(q.key)));
const work = mkdtempSync(join(tmpdir(), 'dax-scale-'));
const requestFile = join(work, 'request.json'), timesFile = join(work, 'times.json');
writeFileSync(requestFile, JSON.stringify({
  queries: asked.map(q => ({ id: q.key, model: resolve(modelDir, 'model.bim'), data: resolve(modelDir, 'data'), dax: q.dax, roles: q.roles })),
}));

const norm = rows => rows.map(r => JSON.stringify(r.map(v => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toPrecision(9)) : v)))).sort();
const results = new Map();
const t0 = performance.now();
const child = spawn(`${adapter} "${requestFile}"`, { shell: true, stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, DAXSQL_TIMES: timesFile } });
for await (const line of createInterface({ input: child.stdout })) {
  if (!line.trim()) continue;
  let a;
  try { a = JSON.parse(line); } catch { continue; }
  const d = duck[a.id];
  if (a.error) results.set(a.id, { id: a.id, outcome: /timeout/i.test(a.error) ? 'timeout' : 'error', detail: a.error });
  else {
    const hash = createHash('sha1').update(norm(a.rows).join('\n')).digest('hex');
    results.set(a.id, { id: a.id, outcome: hash === d.hash ? 'same' : 'differs', detail: hash === d.hash ? '' : `${a.rows.length} rows, DuckDB ${d.rows}` });
  }
  if (results.size % 100 === 0) console.log(`… ${results.size}/${asked.length}, ${((performance.now() - t0) / 1000).toFixed(0)} s`);
}
await new Promise(r => (child.exitCode != null ? r() : child.on('exit', r)));
for (const q of asked) if (!results.has(q.key)) results.set(q.key, { id: q.key, outcome: 'error', detail: 'no answer from the adapter' });

let times = [];
try { times = JSON.parse(readFileSync(timesFile, 'utf8')); } catch {}
const ms = new Map(times.map(t => [t.id, t.ms]));
for (const r of results.values()) r.ms = ms.get(r.id) ?? null;
const all = [...results.values()];
const count = o => all.filter(r => r.outcome === o).length;
const timed = all.filter(r => r.ms != null).map(r => r.ms).sort((a, b) => a - b);
const pct = p => (timed.length ? timed[Math.min(timed.length - 1, Math.floor(p * timed.length))] : 0);
const total = timed.reduce((s, v) => s + v, 0);
const line = r => `| ${r.id} | ${r.ms ?? ''} | ${r.outcome} | ${String(r.detail).replaceAll('|', '\\|').slice(0, 160)} |`;
const summary = [
  `### ${label}, tpcds at scale: ${asked.length} queries (${queries.length - asked.length} left out: more than ${maxRows} rows on DuckDB, or none)`, '',
  `| same as DuckDB | differs | error | timeout | time (median, p90, max) |`, '|---|---|---|---|---|',
  `| ${count('same')} | ${count('differs')} | ${count('error')} | ${count('timeout')} | ${(total / 1000).toFixed(1)} s (${pct(0.5)} ms, ${pct(0.9)} ms, ${pct(1)} ms) |`, '',
  '#### The slowest 15', '', '| query | ms | outcome | |', '|---|---|---|---|',
  ...all.filter(r => r.ms != null).sort((a, b) => b.ms - a.ms).slice(0, 15).map(line), '',
  ...(all.some(r => r.outcome !== 'same') ? ['#### Not as DuckDB', '', '| query | ms | outcome | |', '|---|---|---|---|', ...all.filter(r => r.outcome !== 'same').map(line), ''] : []),
].join('\n');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
if (report) writeFileSync(report, JSON.stringify(all, null, 1));
