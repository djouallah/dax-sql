// The engines' runs of the tpcds queries at scale side by side (.github/workflows/scale.yml): each
// engine's time on the queries every engine answered, its answers against DuckDB's, and the
// slowest queries with every engine's time.
//   node tools/tpcds/scale-compare.mjs <dir with duckdb.json and <engine>.json reports> [--top 25]
// duckdb.json is tools/tpcds/scale-run.mjs's report (ms, rows, error); another engine's is
// tools/tpcds/scale-engine.mjs's (ms, outcome: same, differs, error, timeout).
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const top = args.includes('--top') ? Number(args.splice(args.indexOf('--top'), 2)[1]) : 25;
const [dir] = args;
const reports = new Map();
for (const f of readdirSync(dir).filter(x => x.endsWith('.json') && x !== 'answers.json')) {
  const name = f.slice(0, -5);
  const rows = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  reports.set(name, new Map(rows.map(r => [r.id, name === 'duckdb'
    ? { ms: r.error || r.compileError ? null : r.ms, outcome: r.error ? (/timeout/.test(r.error) ? 'timeout' : 'error') : r.compileError || r.daxError ? 'refused' : 'same' }
    : { ms: r.outcome === 'same' || r.outcome === 'differs' ? r.ms : null, outcome: r.outcome }])));
}
const engines = ['duckdb', ...[...reports.keys()].filter(e => e !== 'duckdb').sort()].filter(e => reports.has(e));
if (!engines.length) { console.log('no reports'); process.exit(0); }
// The queries every engine answered: their times compare.
const ids = [...reports.get(engines[0]).keys()].filter(id => engines.every(e => reports.get(e).get(id)?.ms != null));
const sum = e => ids.reduce((s, id) => s + reports.get(e).get(id).ms, 0);
const median = e => { const v = ids.map(id => reports.get(e).get(id).ms).sort((a, b) => a - b); return v[Math.floor(v.length / 2)] ?? 0; };
const count = (e, o) => [...reports.get(e).values()].filter(r => r.outcome === o).length;
const base = sum('duckdb') || 1;
const s = x => (x / 1000).toFixed(1);
const lines = [
  `### tpcds at scale, by engine: ${ids.length} queries every engine answered`, '',
  '| engine | time | × DuckDB | median | same as DuckDB | differs | error | timeout |', '|---|---|---|---|---|---|---|---|',
  ...engines.map(e => `| ${e} | ${s(sum(e))} s | ${(sum(e) / base).toFixed(2)} | ${median(e)} ms | ${e === 'duckdb' ? '—' : count(e, 'same')} | ${e === 'duckdb' ? '—' : count(e, 'differs')} | ${count(e, 'error')} | ${count(e, 'timeout')} |`), '',
  `#### The slowest ${top} (by the slowest engine's time)`, '',
  `| query | ${engines.join(' | ')} |`, `|---|${engines.map(() => '---').join('|')}|`,
  ...[...reports.get(engines[0]).keys()]
    .map(id => ({ id, t: engines.map(e => reports.get(e).get(id)) }))
    .sort((a, b) => Math.max(...b.t.map(r => r?.ms ?? 0)) - Math.max(...a.t.map(r => r?.ms ?? 0)))
    .slice(0, top)
    .map(({ id, t }) => `| ${id} | ${t.map(r => (r?.ms != null ? `${r.ms}` : r?.outcome ?? '')).join(' | ')} |`), '',
];
const text = lines.join('\n');
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
