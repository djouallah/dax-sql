// The engines' runs of the tpcds queries at scale side by side (.github/workflows/scale.yml): each
// engine's time against DuckDB's on the queries both answered, its answers against DuckDB's, the
// slowest queries with every engine's time, and the queries whose SQL is very bad against the SQL
// written by hand (engines/hand).
//   node tools/tpcds/scale-compare.mjs <dir with duckdb.json and <engine>.json reports> [--top 25] [--bad 5] [--bad-ms 500]
// duckdb.json is tools/tpcds/scale-run.mjs's report (ms, bytes, rows, error); another engine's is
// tools/tpcds/scale-engine.mjs's (ms, bytes, outcome: same, differs, error, timeout).
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, d) => (args.includes(name) ? Number(args.splice(args.indexOf(name), 2)[1]) : d);
const top = opt('--top', 25), badRatio = opt('--bad', 5), badMs = opt('--bad-ms', 500);
const [dir] = args;
const reports = new Map();
for (const f of readdirSync(dir).filter(x => x.endsWith('.json') && x !== 'answers.json')) {
  const name = f.slice(0, -5);
  const rows = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  reports.set(name, new Map(rows.map(r => [r.id, name === 'duckdb'
    ? { ms: r.error || r.compileError || r.daxError ? null : r.ms, bytes: r.bytes, outcome: r.error ? (/timeout/.test(r.error) ? 'timeout' : 'error') : r.compileError || r.daxError ? 'refused' : 'same' }
    : { ms: r.outcome === 'same' || r.outcome === 'differs' ? r.ms : null, bytes: r.bytes, outcome: r.outcome }])));
}
if (!reports.has('duckdb')) { console.log('no DuckDB report'); process.exit(0); }
const engines = ['duckdb', ...[...reports.keys()].filter(e => e !== 'duckdb').sort()];
const D = reports.get('duckdb');
// The queries an engine and DuckDB both answered: their times compare (the hand-written oracle
// answers only the queries someone wrote SQL for).
const both = e => [...D.keys()].filter(id => D.get(id)?.ms != null && reports.get(e).get(id)?.ms != null);
const sum = (e, ids) => ids.reduce((t, id) => t + reports.get(e).get(id).ms, 0);
const median = (e, ids) => { const v = ids.map(id => reports.get(e).get(id).ms).sort((a, b) => a - b); return v[Math.floor(v.length / 2)] ?? 0; };
const count = (e, o) => [...reports.get(e).values()].filter(r => r.outcome === o).length;
const s = x => (x / 1000).toFixed(1);
const row = e => {
  const ids = both(e), d = sum('duckdb', ids) || 1;
  return `| ${e} | ${ids.length} | ${s(sum(e, ids))} s | ${s(d)} s | ${(sum(e, ids) / d).toFixed(2)} | ${median(e, ids)} ms | ${e === 'duckdb' ? '—' : count(e, 'same')} | ${e === 'duckdb' ? '—' : count(e, 'differs')} | ${count(e, 'error')} | ${count(e, 'timeout')} |`;
};
const lines = [
  '### tpcds at scale, by engine (each on the queries it and DuckDB both answered)', '',
  "| engine | queries | time | DuckDB's | × DuckDB | median | same as DuckDB | differs | error | timeout |", '|---|---|---|---|---|---|---|---|---|---|',
  ...engines.map(row), '',
  `#### The slowest ${top} (by the slowest engine's time)`, '',
  `| query | ${engines.join(' | ')} |`, `|---|${engines.map(() => '---').join('|')}|`,
  ...[...D.keys()]
    .map(id => ({ id, t: engines.map(e => reports.get(e).get(id)) }))
    .sort((a, b) => Math.max(...b.t.map(r => r?.ms ?? 0)) - Math.max(...a.t.map(r => r?.ms ?? 0)))
    .slice(0, top)
    .map(({ id, t }) => `| ${id} | ${t.map(r => (r?.ms != null ? `${r.ms}` : r?.outcome ?? '')).join(' | ')} |`), '',
];
// dax-sql's SQL against the SQL written by hand. Not a target to match: a way to find the queries
// whose SQL is very bad, those --bad times the hand's or more and --bad-ms slower at least.
if (reports.has('hand')) {
  const H = reports.get('hand'), ids = both('hand');
  const kb = b => (b == null ? '' : (b / 1024).toFixed(1));
  const ratio = id => Math.max(D.get(id).ms, 1) / Math.max(H.get(id).ms, 1);
  const bad = ids.filter(id => ratio(id) >= badRatio && D.get(id).ms - H.get(id).ms >= badMs).sort((a, b) => ratio(b) - ratio(a));
  const differ = ids.filter(id => H.get(id).outcome === 'differs');
  lines.push(`### dax-sql's SQL against SQL written by hand: ${ids.length} queries`, '',
    `dax-sql ${s(sum('duckdb', ids))} s, by hand ${s(sum('hand', ids))} s. Very bad (${badRatio}× the hand's time or more, and ${badMs} ms slower): ${bad.length}. `
      + `Answers otherwise than dax-sql's: ${differ.length}.`, '',
    ...(bad.length || differ.length ? ['| query | dax-sql ms | hand ms | × hand | dax-sql KB | hand KB | answer |', '|---|---|---|---|---|---|---|',
      ...[...new Set([...bad, ...differ])].map(id => `| ${id} | ${D.get(id).ms} | ${H.get(id).ms} | ${ratio(id).toFixed(1)} | ${kb(D.get(id).bytes)} | ${kb(H.get(id).bytes)} | ${H.get(id).outcome} |`), ''] : []));
}
const text = lines.join('\n');
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
