// Runs the suite against an engine through its adapter, and holds each answer against Power
// BI's (golden/). The engine is a black box: the runner knows only the adapter protocol
// (README.md).
//
//   node runner/run.mjs --adapter "<command>" [--known known.json] [--model m] [--family f]
//                       [--grep regex] [--report report.json]
//
// Outcomes: match; fail (other rows); error (the engine failed where Power BI answered);
// unsupported (the engine says it does not handle the query); pending (no golden yet, or a
// stale one); invalid (Power BI rejected the query: the query is to be fixed, unless it says
// `expect: error`, a rule of DAX the engine must enforce too).
// --known lists ids ([{ id, reason }]) the engine is known to get wrong. The exit code is 1
// when a query fails, errs or is unsupported without being listed, or a listed one matches.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadQueries, loadGoldens, modelDir } from '../tools/suite.mjs';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const adapter = opt('adapter');
if (!adapter) {
  console.error('usage: node runner/run.mjs --adapter "<command>" [--known known.json] [--model m] [--family f] [--grep regex] [--report report.json]');
  process.exit(2);
}
const knownFile = opt('known');
const known = new Map(knownFile && existsSync(knownFile) ? JSON.parse(readFileSync(knownFile, 'utf8')).map(k => [k.id, k.reason]) : []);
const grep = opt('grep') && new RegExp(opt('grep'));

const queries = loadQueries({ model: opt('model') })
  .filter(q => !opt('family') || q.family === opt('family'))
  .map(q => ({ ...q, key: `${q.model}/${q.family}/${q.id}` }))
  .filter(q => !grep || grep.test(q.key));
const goldens = new Map();
const golden = q => {
  const k = `${q.model}/${q.family}`;
  if (!goldens.has(k)) goldens.set(k, loadGoldens(q.model, q.family));
  return goldens.get(k)[q.id];
};

// --- the adapter ---

const dir = mkdtempSync(join(tmpdir(), 'dax-conformance-'));
const requestFile = join(dir, 'request.json');
writeFileSync(requestFile, JSON.stringify({
  version: 1,
  queries: queries.map(q => ({
    id: q.key, model: resolve(modelDir(q.model), 'model.bim'), data: resolve(modelDir(q.model), 'data'), dax: q.dax, roles: q.roles,
  })),
}));
const { map: answers, code: adapterCode } = await new Promise((done, fail) => {
  const child = spawn(`${adapter} "${requestFile}"`, { shell: true, stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.on('error', fail);
  child.on('close', code => {
    const map = new Map();
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      let a;
      try { a = JSON.parse(line); } catch { continue; }
      if (a?.id) map.set(a.id, a);
    }
    if (code !== 0) console.error(`adapter exited with ${code}`);
    done({ map, code });
  });
});

// --- comparing ---

const close = (a, b) => {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  return false;
};
const sortRows = rows => {
  const key = r => JSON.stringify(r.map(v => (v === null ? '' : typeof v === 'number' ? Number(v.toPrecision(12)) : v)));
  return rows.map(r => [key(r), r]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, r]) => r);
};
const sameRows = (got, want, ordered) => {
  if (got.length !== want.length) return false;
  const g = ordered ? got : sortRows(got), w = ordered ? want : sortRows(want);
  return g.every((r, i) => r.length === w[i].length && r.every((v, j) => close(v, w[i][j])));
};
const ordered = dax => /\bORDER\s+BY\b/i.test(dax.replace(/\/\/.*$/gm, ''));

function outcome(q) {
  const g = golden(q), a = answers.get(q.key) ?? { error: 'no answer from the adapter' };
  if (!g || g.hash !== q.hash) return { kind: 'pending', detail: a.error ? `engine: ${a.error}` : `engine: ${a.rows?.length} rows` };
  if (g.error && q.expect === 'error') {
    // A query that tests a rule of DAX: the engine has to reject it, as Power BI does.
    if (a.unsupported) return { kind: 'unsupported', detail: a.error };
    return a.error ? { kind: 'match' } : { kind: 'fail', detail: `rows where Power BI raises: ${g.error}` };
  }
  if (g.error) return a.error && !a.unsupported ? { kind: 'match' } : { kind: 'invalid', detail: g.error };
  if (a.unsupported) return { kind: 'unsupported', detail: a.error };
  if (a.error) return { kind: 'error', detail: a.error };
  if (sameRows(a.rows ?? [], g.rows, ordered(q.dax))) return { kind: 'match' };
  return { kind: 'fail', detail: `got ${JSON.stringify(a.rows).slice(0, 400)}\n    want ${JSON.stringify(g.rows).slice(0, 400)}` };
}

const KINDS = ['match', 'fail', 'error', 'unsupported', 'pending', 'invalid'];
const score = new Map();
const report = [];
let bad = adapterCode ? 1 : 0;
for (const q of queries) {
  const o = outcome(q);
  const group = `${q.model}/${q.family}`;
  if (!score.has(group)) score.set(group, Object.fromEntries([...KINDS, 'known'].map(k => [k, 0])));
  const s = score.get(group);
  s[o.kind]++;
  const isKnown = known.has(q.key);
  let verdict = '';
  if (o.kind === 'match' && isKnown) { bad++; verdict = 'matches now: remove it from the known list'; }
  else if (['fail', 'error', 'unsupported'].includes(o.kind)) {
    if (isKnown) s.known++;
    else { bad++; verdict = 'unexpected'; }
  }
  report.push({ id: q.key, note: q.note, outcome: o.kind, known: isKnown, detail: o.detail ?? null });
  if (verdict) console.log(`${o.kind.toUpperCase()} ${q.key} (${verdict})${q.note ? ` - ${q.note}` : ''}${o.detail ? `\n    ${o.detail}` : ''}`);
}

const pad = (x, n) => String(x).padStart(n);
const total = Object.fromEntries([...KINDS, 'known'].map(k => [k, 0]));
console.log(`\n${'family'.padEnd(28)}${KINDS.map(k => pad(k, 12)).join('')}${pad('(known)', 10)}`);
for (const [group, s] of [...score].sort()) {
  for (const k in total) total[k] += s[k];
  console.log(`${group.padEnd(28)}${KINDS.map(k => pad(s[k], 12)).join('')}${pad(s.known, 10)}`);
}
console.log(`${'total'.padEnd(28)}${KINDS.map(k => pad(total[k], 12)).join('')}${pad(total.known, 10)}`);
if (opt('report')) writeFileSync(opt('report'), JSON.stringify({ score: Object.fromEntries(score), total, queries: report }, null, 1));
process.exit(bad ? 1 : 0);
