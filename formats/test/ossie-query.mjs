// Apache Ossie's query compliance cases (compliance/query in an Ossie checkout), answered by
// dax-sql: .github/workflows/ossie-query.yml.
//   node formats/test/ossie-query.mjs <ossie checkout>
// The cases are in either of two layouts, and this reads whichever the checkout has:
//   - cases/<case>/query.ossie.sql and expected.sql (Ossie's main): the expected rows are what
//     DuckDB answers to expected.sql;
//   - <case>.ost, a script (apache/ossie#769, the view expander's): the query is the argument of
//     executeExpand(...), and the expected rows the table after its expansion (`|_} : string`).
// The SCOTT data (scott/scott.sql) is loaded into DuckDB, the model (scott/scott_model.ossie.yaml)
// read with formats/ossie.js, and the query compiled as a host compiles one: compile(), or, for
// SQL with a model SELECT in it, compileStatement(). Rows are compared as ossie-compare.mjs does.
// Outcomes: match, fail (other rows), unsupported (dax-sql's UNSUPPORTED), error (any other).
// A fail always fails the run. PENDING lists the cases not answered yet: those may be
// unsupported or an error, and one that matches must leave the list.
import { readFileSync, readdirSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { parse } from 'yaml';
import { createCompiler } from '../../src/index.js';
import { ossieToModel } from '../ossie.js';
import { table, ordered, compare, rows } from './ossie-compare.mjs';

const PENDING = new Set([]);
// The joins along the model's relationships, from many to one (a star): their query is
// SUMMARIZECOLUMNS, not the joined rows. Each case's path is in the report.
const STAR = new Set(['B1', 'B2', 'B4', 'B10a', 'B14', 'B15', 'B16', 'B17', 'B18', 'B20']);
const pathOf = daxText => (/TREATAS\(SELECTCOLUMNS\(FILTER\(__v/.test(daxText) ? 'joined rows' : 'SUMMARIZECOLUMNS');

const ossie = process.argv[2];
if (!ossie) throw new Error('usage: ossie-query.mjs <ossie checkout>');
const dir = join(ossie, 'compliance', 'query');
const MODEL = 'scott_model';

// --- the cases ----------------------------------------------------------------------------

// The text from `open` (just after a "(") to its ")", by depth, outside strings and quoted names.
function closing(s, open) {
  let depth = 1;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"') { i = s.indexOf(c, i + 1); if (i < 0) break; continue; }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  throw new Error('executeExpand( with no closing ")"');
}

const caseId = id => id.replace(/^([AB])0*(\d)/, '$1$2');

// The cases of an .ost script.
function scriptCases(file) {
  const src = readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n');
  const out = [];
  let from = 0;
  for (;;) {
    const at = src.indexOf('executeExpand(', from);
    if (at < 0) return out;
    const open = at + 'executeExpand('.length;
    const close = closing(src, open);
    const ids = [...src.slice(0, at).matchAll(/^# ([AB]\d+[a-z]?)\. /gm)];
    const id = ids.length ? caseId(ids[ids.length - 1][1]) : `${file}#${out.length + 1}`;
    const tail = src.slice(close);
    const end = tail.indexOf('|_}');
    if (end < 0) throw new Error(`${id}: no expansion`);
    const lines = tail.slice(end).split('\n').slice(1);
    const stop = lines.findIndex(l => !l.startsWith('+') && !l.startsWith('|'));
    const expected = table(lines.slice(0, stop < 0 ? undefined : stop));
    out.push({ id, file, query: src.slice(open, close).trim(), expected: async () => expected, round: true });
    from = close;
  }
}

// A case of cases/<case>/: its query, and expected.sql's rows.
function dirCase(name) {
  const at = join(dir, 'cases', name);
  const query = readFileSync(join(at, 'query.ossie.sql'), 'utf8').replace(/\r\n/g, '\n');
  const head = query.match(/^-- ([AB]\d+[a-z]?)\. /m);
  const id = caseId(head ? head[1] : name.split('_')[0].toUpperCase());
  const expected = readFileSync(join(at, 'expected.sql'), 'utf8');
  return { id, file: `cases/${name}`, query: query.trim(), expected: () => rows(con, expected), round: false };
}

// --- running -------------------------------------------------------------------------------

const db = await DuckDBInstance.create(':memory:');
const con = await db.connect();
await con.run(readFileSync(join(dir, 'scott', 'scott.sql'), 'utf8'));
let dax;
try {
  dax = createCompiler(ossieToModel(parse(readFileSync(join(dir, 'scott', 'scott_model.ossie.yaml'), 'utf8'))));
} catch (e) {
  console.log(`::error::the SCOTT model does not read: ${e.message}`);
  process.exit(1);
}

function compileCase(q) {
  try {
    return dax.compile(q).sql;
  } catch (e) {
    // SQL of the engine with a model SELECT in it.
    let st = null;
    try { st = dax.compileStatement(q, MODEL); } catch { /* the first error says more */ }
    if (st?.relations?.length) return st.sql;
    throw e;
  }
}

const all = [
  ...(existsSync(join(dir, 'cases')) ? readdirSync(join(dir, 'cases')).filter(d => existsSync(join(dir, 'cases', d, 'query.ossie.sql'))).sort().map(dirCase) : []),
  ...readdirSync(dir).filter(f => f.endsWith('.ost')).sort().flatMap(scriptCases),
];
if (!all.length) { console.log(`::error::no query cases in ${dir}`); process.exit(1); }
const results = [];
{
  for (const c of all) {
    let outcome, detail = '', sql = null;
    try {
      sql = compileCase(c.query);
      const got = await rows(con, sql);
      const diff = compare(got, await c.expected(), ordered(c.query), { round: c.round });
      outcome = diff ? 'fail' : 'match';
      detail = diff ?? '';
    } catch (e) {
      outcome = e.code === 'UNSUPPORTED' ? 'unsupported' : 'error';
      detail = `${e.code ? `${e.code}: ` : ''}${e.message.split('\n')[0]}`;
    }
    let path = '';
    try { path = pathOf(dax.sqlToDax(c.query).dax); } catch { /* SQL with a model SELECT in it */ }
    results.push({ ...c, expected: undefined, outcome, detail, sql, path });
  }
}

// --- the report ----------------------------------------------------------------------------

const bad = [];
for (const r of results) {
  if (r.outcome === 'fail') bad.push(`${r.id}: wrong rows: ${r.detail}`);
  else if (r.outcome === 'match' && PENDING.has(r.id)) bad.push(`${r.id} matches now: take it off PENDING`);
  else if (r.outcome !== 'match' && !PENDING.has(r.id)) bad.push(`${r.id}: ${r.outcome}, ${r.detail}`);
  if (STAR.has(r.id) && r.path !== 'SUMMARIZECOLUMNS') bad.push(`${r.id}: a star join, answered by the joined rows`);
}
// B10a is one of #769's cases, not yet main's.
for (const id of STAR) if (!results.some(r => r.id === id) && !/[a-z]$/.test(id)) bad.push(`${id} is on STAR but no case has that id`);
const ids = new Set(results.map(r => r.id));
for (const id of PENDING) if (!ids.has(id)) bad.push(`${id} is on PENDING but no case has that id`);

const counts = Object.groupBy(results, r => r.outcome);
const summary = [
  `### Ossie query compliance: ${counts.match?.length ?? 0} of ${results.length} match`, '',
  '| case | outcome | path | detail |', '|---|---|---|---|',
  ...results.map(r => `| ${r.id} | ${r.outcome} | ${r.path} | ${r.detail.replaceAll('|', '\\|')} |`), '',
].join('\n');
console.log(summary);
// What each case that does not match was translated to: its DAX, and its SQL.
for (const r of results.filter(x => x.outcome !== 'match')) {
  let daxText;
  try { daxText = dax.sqlToDax(r.query).dax; } catch (e) { daxText = `(${e.message.split('\n')[0]})`; }
  console.log(`--- ${r.id} (${r.file}): ${r.outcome}\n${r.query}\n--- DAX\n${daxText}\n--- SQL\n${r.sql ?? '(none)'}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
for (const b of bad) console.log(`::error::${b}`);
process.exit(bad.length ? 1 : 0);
