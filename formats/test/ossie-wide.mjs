// Apache Ossie's wide table compliance cases (compliance/wide_table in an Ossie checkout), each
// by its Layer 3 query, the JSON that executeLower takes, through formats/ossie-wide.js
// (compileWide): a case that returns rows must return them, one that raises an error must raise
// its code (Section 8). Each case that also gives its Layer 2 query (the lowering of its Section
// 5, between {_| and |_}) is answered that way too. .github/workflows/ossie-query.yml.
//   node formats/test/ossie-wide.mjs <ossie checkout>
// Each case is an .ost script: connect("<data>") (<data>/<data>.sql loaded into DuckDB),
// modelFile(name, "<path>") (read with formats/ossie.js), then executeLower(name, <JSON>), and
// the rows after it as an ost table, or `> error: <code>: ...`. Rows are compared as
// ossie-compare.mjs does. A case that does not pass fails the run, unless on PENDING; one on
// PENDING that passes must leave it.
import { readFileSync, readdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { parse } from 'yaml';
import { createCompiler } from '../../src/index.js';
import { ossieToModel } from '../ossie.js';
import { compileWide } from '../ossie-wide.js';
import { table, compare, rows } from './ossie-compare.mjs';

const PENDING = new Set([]);

const ossie = process.argv[2];
if (!ossie) throw new Error('usage: ossie-wide.mjs <ossie checkout>');
const dir = join(ossie, 'compliance', 'wide_table');
const text = p => readFileSync(join(dir, p), 'utf8').replace(/\r\n/g, '\n');

// One DuckDB and model per fixture: a case's data and model, `<data>|<model path>`.
const fixtures = new Map();
async function fixture(name) {
  if (fixtures.has(name)) return fixtures.get(name);
  const [data, model] = name.split('|');
  const db = await DuckDBInstance.create(':memory:');
  const con = await db.connect();
  await con.run(text(`${data}/${data}.sql`));
  const doc = parse(text(model));
  const f = { con, doc, dax: createCompiler(ossieToModel(doc)) };
  fixtures.set(name, f);
  return f;
}

// executeLower(name, <JSON>): the JSON, from its opening brace to the one that closes it.
function jsonOf(src) {
  const at = src.indexOf('executeLower(');
  if (at < 0) return null;
  const open = src.indexOf('{', at);
  let depth = 0, inStr = false;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (inStr) { if (ch === '\\') i++; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return JSON.parse(src.slice(open, i + 1));
  }
  return null;
}
// The ost table that follows the line `marker` starts.
function tableAfter(lines, marker) {
  const at = lines.findIndex(l => marker.test(l));
  if (at < 0) return null;
  const rest = lines.slice(at + 1), stop = rest.findIndex(l => !l.startsWith('+') && !l.startsWith('|'));
  return table(rest.slice(0, stop < 0 ? undefined : stop));
}

const cases = readdirSync(dir).filter(f => f.endsWith('.ost')).sort();
if (!cases.length) { console.log(`::error::no wide table cases in ${dir}`); process.exit(1); }
const results = [];
for (const file of cases) {
  const name = file.slice(0, -4), id = name.split('_')[0].toUpperCase();
  const src = text(file).split('\n').filter(l => !l.startsWith('#')).join('\n'), lines = src.split('\n');
  const data = src.match(/connect\("([^"]+)"\)/)?.[1], model = src.match(/modelFile\("[^"]+",\s*"([^"]+)"\)/)?.[1];
  const fx = data && model ? `${data}|${model}` : null;
  const wantError = src.match(/^> error: (E_[A-Z_]+)/m)?.[1] ?? null;
  const r = { id, name, fx, outcome: 'error', detail: '', sql: null, layer2: null, l2: null };
  results.push(r);
  let query;
  try { query = jsonOf(src); } catch (e) { r.detail = `the case's JSON does not parse: ${e.message}`; continue; }
  r.query = query;
  if (!fx || !query) { r.detail = 'the case names no data, model or query'; continue; }
  const f = await fixture(fx);
  try {
    const out = compileWide(f.doc, query);
    r.sql = out.sql; r.layer2 = out.layer2;
    if (wantError) { r.outcome = 'fail'; r.detail = `rows where Ossie raises ${wantError}`; }
    else {
      const diff = compare(await rows(f.con, out.sql), tableAfter(lines, /^\|_?\}/), false, { round: true });
      r.outcome = diff ? 'fail' : 'match';
      r.detail = diff ?? '';
    }
  } catch (e) {
    if (wantError && e.wide === wantError) { r.outcome = 'match'; r.detail = e.message.split('\n')[0]; }
    else if (wantError && e.wide) { r.outcome = 'fail'; r.detail = `${e.wide} where Ossie raises ${wantError}: ${e.message.split('\n')[0]}`; }
    else { r.outcome = e.code === 'UNSUPPORTED' ? 'unsupported' : 'error'; r.detail = `${e.code ? `${e.code}: ` : ''}${e.message.split('\n')[0]}`; }
  }
  // The case's own Layer 2 query, where it gives one, answered by dax-sql as well.
  const start = src.indexOf('{_|'), end = src.indexOf('|_}');
  if (!wantError && start >= 0 && end > start) {
    const l2 = src.slice(start + 3, end).trim();
    try {
      const diff = compare(await rows(f.con, f.dax.compileStatement(l2, f.doc.name).sql), tableAfter(lines, /^\|_\}/), false, { round: true });
      r.l2 = diff ? `fail: ${diff}` : 'match';
    } catch (e) { r.l2 = `error: ${e.message.split('\n')[0]}`; }
  }
}

const bad = [];
for (const r of results) {
  if (r.outcome === 'match' && PENDING.has(r.id)) bad.push(`${r.id} passes now: take it off PENDING`);
  else if (r.outcome !== 'match' && !PENDING.has(r.id)) bad.push(`${r.id}: ${r.outcome}, ${r.detail}`);
  if (r.l2 && r.l2 !== 'match') bad.push(`${r.id}: its Layer 2 query: ${r.l2}`);
}
const ids = new Set(results.map(r => r.id));
for (const id of PENDING) if (!ids.has(id)) bad.push(`${id} is on PENDING but no case has that id`);

const pass = results.filter(r => r.outcome === 'match').length, l2 = results.filter(r => r.l2);
const summary = [
  `### Ossie wide table compliance, Layer 3 queries: ${pass} of ${results.length} pass (rows, or the error's code); their Layer 2 queries: ${l2.filter(r => r.l2 === 'match').length} of ${l2.length} match`, '',
  '| case | outcome | detail | Layer 2 |', '|---|---|---|---|',
  ...results.map(r => `| ${r.name} | ${r.outcome} | ${r.detail.replaceAll('|', '\\|')} | ${r.l2 ?? ''} |`), '',
].join('\n');
console.log(summary);
for (const r of results.filter(x => x.outcome !== 'match')) {
  console.log(`--- ${r.name}: ${r.outcome}\n${JSON.stringify(r.query)}\n--- Layer 2\n${r.layer2 ?? '(none)'}\n--- SQL\n${r.sql ?? '(none)'}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
for (const b of bad) console.log(`::error::${b}`);
process.exit(bad.length ? 1 : 0);
