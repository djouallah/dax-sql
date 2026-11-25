// Apache Ossie's wide table compliance cases (compliance/wide_table in an Ossie checkout) that
// raise an error: each by its Layer 3 query, the JSON that executeLower takes, through
// formats/ossie-wide.js (compileWide), must raise its code (Section 8). A case that answers rows is
// Power BI's to answer: conformance/tools/ossie/build.mjs writes it as DAX for the suite
// (queries/<model>/wide). .github/workflows/ossie-query.yml.
//   node formats/test/ossie-wide.mjs <ossie checkout>
// Each case is an .ost script: modelFile(name, "<path>") (read with formats/ossie.js), then
// executeLower(name, <JSON>), and `> error: <code>: ...`. A case that does not raise its code fails
// the run, unless on PENDING; one on PENDING that does must leave it.
import { readFileSync, readdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { compileWide } from '../ossie-wide.js';

const PENDING = new Set([]);

const ossie = process.argv[2];
if (!ossie) throw new Error('usage: ossie-wide.mjs <ossie checkout>');
const dir = join(ossie, 'compliance', 'wide_table');
const text = p => readFileSync(join(dir, p), 'utf8').replace(/\r\n/g, '\n');
const docs = new Map();
const docOf = path => (docs.has(path) ? docs.get(path) : docs.set(path, parse(text(path))).get(path));

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

const cases = readdirSync(dir).filter(f => f.endsWith('.ost')).sort();
if (!cases.length) { console.log(`::error::no wide table cases in ${dir}`); process.exit(1); }
const results = [];
for (const file of cases) {
  const name = file.slice(0, -4), id = name.split('_')[0].toUpperCase();
  const src = text(file).split('\n').filter(l => !l.startsWith('#')).join('\n');
  const wantError = src.match(/^> error: (E_[A-Z_]+)/m)?.[1] ?? null;
  if (!wantError) continue;
  const model = src.match(/modelFile\("[^"]+",\s*"([^"]+)"\)/)?.[1];
  const r = { id, name, wantError, outcome: 'error', detail: '' };
  results.push(r);
  let query;
  try { query = jsonOf(src); } catch (e) { r.detail = `the case's JSON does not parse: ${e.message}`; continue; }
  r.query = query;
  if (!model || !query) { r.detail = 'the case names no model or query'; continue; }
  try {
    compileWide(docOf(model), query);
    r.outcome = 'fail'; r.detail = `rows where Ossie raises ${wantError}`;
  } catch (e) {
    if (e.wide === wantError) { r.outcome = 'match'; r.detail = e.message.split('\n')[0]; }
    else if (e.wide) { r.outcome = 'fail'; r.detail = `${e.wide} where Ossie raises ${wantError}: ${e.message.split('\n')[0]}`; }
    else { r.outcome = e.code === 'UNSUPPORTED' ? 'unsupported' : 'error'; r.detail = `${e.code ? `${e.code}: ` : ''}${e.message.split('\n')[0]}`; }
  }
}

const bad = [];
for (const r of results) {
  if (r.outcome === 'match' && PENDING.has(r.id)) bad.push(`${r.id} passes now: take it off PENDING`);
  else if (r.outcome !== 'match' && !PENDING.has(r.id)) bad.push(`${r.id}: ${r.outcome}, ${r.detail}`);
}
const ids = new Set(results.map(r => r.id));
for (const id of PENDING) if (!ids.has(id)) bad.push(`${id} is on PENDING but no case has that id`);

const pass = results.filter(r => r.outcome === 'match').length;
const summary = [
  `### Ossie wide table compliance, the cases that raise an error: ${pass} of ${results.length} raise its code`, '',
  '| case | expected | outcome | detail |', '|---|---|---|---|',
  ...results.map(r => `| ${r.name} | ${r.wantError} | ${r.outcome} | ${r.detail.replaceAll('|', '\\|')} |`), '',
].join('\n');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
for (const b of bad) console.log(`::error::${b}`);
process.exit(bad.length ? 1 : 0);
