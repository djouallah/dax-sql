// Debugging another engine at scale: for each tpcds query matching a regex, its answer on DuckDB
// (the SF1 DuckDB file) and on the engine (its adapter, over the SF1 model folder), and the rows
// one has and the other not; the engine's SQL written to <out>/<query>.sql.
//   node tools/tpcds/scale-diff.mjs --grep <regex> --duckdb <sf.duckdb> --model-dir <dir>
//     --adapter "<command>" --dialect polars|datafusion [--out <dir>] [--rows 10]
// .github/workflows/scale-debug.yml runs it by hand.
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { loadQueries, modelDir as suiteModel } from '../suite.mjs';
import { engine, value } from '../../engines/dax-sql/db.mjs';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i < 0 ? d : args.splice(i, 2)[1]; };
const grep = opt('--grep', null), duckFile = opt('--duckdb', null), modelDir = opt('--model-dir', null);
const adapter = opt('--adapter', null), dialect = opt('--dialect', 'polars'), out = opt('--out', null), shown = Number(opt('--rows', 10));
if (!grep || !duckFile || !modelDir || !adapter) throw new Error('usage: scale-diff.mjs --grep <regex> --duckdb <sf.duckdb> --model-dir <dir> --adapter "<command>"');
if (out) mkdirSync(out, { recursive: true });

const root = new URL('../../../', import.meta.url);
const e = await engine(root.pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const { DuckDBInstance } = createRequire(new URL('package.json', root))('@duckdb/node-api');
const con = await (await DuckDBInstance.create(duckFile, { access_mode: 'READ_ONLY' })).connect();
const db = await e.database(join(suiteModel('tpcds'), 'model.bim'), null, con);
const duck = e.createCompiler(db.model, { columnNames: 'dax' });
// The engine's SQL as its adapter writes it (engines/dax-sql-<engine>/adapter.mjs).
const name = basename(resolve(modelDir));
const other = e.createCompiler(db.model, {
  dialect, columnNames: 'dax',
  tableSource: dialect === 'polars' ? t => `"${name}__${t.source?.entity ?? t.name}"` : t => `"${String(t.source?.entity ?? t.name).replace(/"/g, '""')}"`,
});

const queries = loadQueries({ model: 'tpcds' }).map(q => ({ ...q, key: `${q.family}/${q.id}` })).filter(q => new RegExp(grep).test(q.key));
const work = mkdtempSync(join(tmpdir(), 'dax-diff-'));
const requestFile = join(work, 'request.json'), timesFile = join(work, 'times.json');
writeFileSync(requestFile, JSON.stringify({ queries: queries.map(q => ({ id: q.key, model: resolve(modelDir, 'model.bim'), data: resolve(modelDir, 'data'), dax: q.dax, roles: q.roles })) }));
const got = new Map();
const child = spawn(`${adapter} "${requestFile}"`, { shell: true, stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, DAXSQL_TIMES: timesFile } });
for await (const line of createInterface({ input: child.stdout })) if (line.trim()) { const a = JSON.parse(line); got.set(a.id, a); }

const norm = r => JSON.stringify(r.map(v => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toPrecision(9)) : v)));
const md = [];
for (const q of queries) {
  md.push(`### ${q.key}`, '', '```dax', q.dax.split('\n').filter(l => !l.startsWith('//')).join('\n').trim(), '```', '');
  try { if (out) writeFileSync(join(out, `${q.key.replace('/', '__')}.sql`), other.planSql(q.dax, { unnest: true }).sql); } catch (err) { md.push(`${dialect} SQL: ${err.message.split('\n')[0]}`, ''); }
  const t0 = performance.now();
  const d = (await con.runAndReadAll(duck.compile(q.dax).sql)).getRowsJS().map(r => r.map(value));
  md.push(`DuckDB: ${d.length} rows, ${Math.round(performance.now() - t0)} ms`);
  const a = got.get(q.key);
  if (!a || a.error) { md.push(`${dialect}: ${a?.error ?? 'no answer'}`, ''); continue; }
  md.push(`${dialect}: ${a.rows.length} rows`);
  const count = rows => { const m = new Map(); for (const r of rows) { const k = norm(r); m.set(k, (m.get(k) ?? 0) + 1); } return m; };
  const cd = count(d), ca = count(a.rows);
  const only = (x, y) => [...x].filter(([k, n]) => (y.get(k) ?? 0) < n).map(([k]) => k);
  const od = only(cd, ca), oa = only(ca, cd);
  if (!od.length && !oa.length) { md.push('the same rows', ''); continue; }
  md.push('', `only DuckDB's (${od.length}):`, '```', ...od.slice(0, shown), '```', `only ${dialect}'s (${oa.length}):`, '```', ...oa.slice(0, shown), '```', '');
}
const text = md.join('\n');
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
