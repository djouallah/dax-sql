// Apache Ossie's query compliance cases (compliance/query in an Ossie checkout), answered by
// dax-sql: .github/workflows/ossie-query.yml.
//   node formats/test/ossie-query.mjs <ossie checkout>
// Each case is a script, <case>.ost: the query is the argument of executeExpand(...), and the
// expected rows the table after its expansion (`|_} : string`). The SCOTT data
// (scott/scott.sql) is loaded into DuckDB, the model (scott/scott_model.ossie.yaml) read with
// formats/ossie.js, and the query compiled as a host compiles one: compile(), or, for SQL with
// a model SELECT in it, compileStatement(). The rows are compared as the cases' README says:
// columns by position (names without regard to case), rows as a multiset, in order when the
// query has an ORDER BY of its own; a number equal, or equal once rounded to 2 places (an
// approximate one, as the cases round them); NULL only to NULL.
// Outcomes: match, fail (other rows), unsupported (dax-sql's UNSUPPORTED), error (any other).
// A fail always fails the run. PENDING lists the cases not answered yet: those may be
// unsupported or an error, and one that matches must leave the list.
import { readFileSync, readdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { parse } from 'yaml';
import { createCompiler } from '../../src/index.js';
import { ossieToModel } from '../ossie.js';

const PENDING = new Set([
  'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12',
  'B1', 'B2', 'B3', 'B4', 'B5', 'B5a', 'B6', 'B7', 'B8', 'B8a', 'B8b', 'B9', 'B9a', 'B10', 'B10a',
  'B11', 'B11a', 'B12', 'B12a', 'B13', 'B13a', 'B14', 'B15', 'B16', 'B17', 'B18', 'B19', 'B20',
]);

const ossie = process.argv[2];
if (!ossie) throw new Error('usage: ossie-query.mjs <ossie checkout>');
const dir = join(ossie, 'compliance', 'query');
const MODEL = 'scott_model';

// --- the scripts ---------------------------------------------------------------------------

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

// An ost table: header, rows; an empty cell is NULL, a "quoted" cell the text in the quotes.
function table(lines) {
  const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  const body = lines.filter(l => l.startsWith('|'));
  const [head, ...rows] = body;
  const cell = c => (c === '' ? null : /^".*"$/.test(c) ? c.slice(1, -1).replaceAll('""', '"') : c);
  return { columns: cells(head), rows: rows.map(r => cells(r).map(cell)) };
}

function cases(file) {
  const src = readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n');
  const out = [];
  let from = 0;
  for (;;) {
    const at = src.indexOf('executeExpand(', from);
    if (at < 0) return out;
    const open = at + 'executeExpand('.length;
    const close = closing(src, open);
    const ids = [...src.slice(0, at).matchAll(/^# ([AB]\d+[a-z]?)\. /gm)];
    const id = ids.length ? ids[ids.length - 1][1].replace(/^([AB])0*(\d)/, '$1$2') : `${file}#${out.length + 1}`;
    const tail = src.slice(close);
    const end = tail.indexOf('|_}');
    if (end < 0) throw new Error(`${id}: no expansion`);
    const lines = tail.slice(end).split('\n').slice(1);
    const stop = lines.findIndex(l => !l.startsWith('+') && !l.startsWith('|'));
    out.push({ id, file, query: src.slice(open, close).trim(), expected: table(lines.slice(0, stop < 0 ? undefined : stop)) });
    from = close;
  }
}

// Whether the query orders its own rows: an ORDER BY outside parentheses.
function ordered(q) {
  let depth = 0, top = '';
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    if (c === "'") { const e = q.indexOf("'", i + 1); i = e < 0 ? q.length : e; top += ' '; continue; }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (!depth) top += c;
  }
  return /\bORDER\s+BY\b/i.test(top);
}

// --- comparing -----------------------------------------------------------------------------

const round2 = x => Math.sign(x) * Math.round(Math.abs(x) * 100 + 1e-9) / 100;
function same(got, want) {
  if (want === null || got === null || got === undefined) return want === null && (got === null || got === undefined);
  if (typeof got === 'bigint') got = Number(got);
  if (typeof got === 'number' || (typeof got === 'object' && got !== null && 'toDouble' in got)) {
    const g = typeof got === 'number' ? got : got.toDouble();
    const w = Number(want);
    if (Number.isNaN(w)) return false;
    return g === w || round2(g) === w;
  }
  if (got instanceof Date) return got.toISOString().slice(0, 10) === want || got.toISOString().replace('T', ' ').replace(/\.000Z$/, '') === want;
  if (typeof got === 'boolean') return String(got) === lcs(want);
  return String(got) === want;
}
const lcs = s => String(s).toLowerCase();
const show = v => (v === null || v === undefined ? 'NULL' : typeof v === 'bigint' ? String(v) : typeof v === 'object' && 'toDouble' in v ? String(v.toDouble()) : String(v));

function compare(got, want, inOrder) {
  if (got.columns.length !== want.columns.length) return `${got.columns.length} columns (${got.columns.join(', ')}), not ${want.columns.length} (${want.columns.join(', ')})`;
  const names = got.columns.map((c, i) => [c, want.columns[i]]).filter(([g, w]) => lcs(g) !== lcs(w));
  if (names.length) return `columns named ${got.columns.join(', ')}, not ${want.columns.join(', ')}`;
  if (got.rows.length !== want.rows.length) return `${got.rows.length} rows, not ${want.rows.length}`;
  const eq = (g, w) => g.every((v, i) => same(v, w[i]));
  if (inOrder) {
    const i = got.rows.findIndex((r, k) => !eq(r, want.rows[k]));
    return i < 0 ? null : `row ${i + 1} is ${got.rows[i].map(show).join(' | ')}, not ${want.rows[i].map(show).join(' | ')}`;
  }
  const left = [...want.rows];
  for (const r of got.rows) {
    const k = left.findIndex(w => eq(r, w));
    if (k < 0) return `row ${r.map(show).join(' | ')} is not expected`;
    left.splice(k, 1);
  }
  return null;
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

const results = [];
for (const file of readdirSync(dir).filter(f => f.endsWith('.ost')).sort()) {
  for (const c of cases(file)) {
    let outcome, detail = '', sql = null;
    try {
      sql = compileCase(c.query);
      const r = await con.runAndReadAll(sql);
      const got = { columns: r.columnNames(), rows: r.getRowsJS() };
      const diff = compare(got, c.expected, ordered(c.query));
      outcome = diff ? 'fail' : 'match';
      detail = diff ?? '';
    } catch (e) {
      outcome = e.code === 'UNSUPPORTED' ? 'unsupported' : 'error';
      detail = `${e.code ? `${e.code}: ` : ''}${e.message.split('\n')[0]}`;
    }
    results.push({ ...c, outcome, detail, sql });
  }
}

// --- the report ----------------------------------------------------------------------------

const bad = [];
for (const r of results) {
  if (r.outcome === 'fail') bad.push(`${r.id}: wrong rows: ${r.detail}`);
  else if (r.outcome === 'match' && PENDING.has(r.id)) bad.push(`${r.id} matches now: take it off PENDING`);
  else if (r.outcome !== 'match' && !PENDING.has(r.id)) bad.push(`${r.id}: ${r.outcome}, ${r.detail}`);
}
const ids = new Set(results.map(r => r.id));
for (const id of PENDING) if (!ids.has(id)) bad.push(`${id} is on PENDING but no case has that id`);

const counts = Object.groupBy(results, r => r.outcome);
const summary = [
  `### Ossie query compliance: ${counts.match?.length ?? 0} of ${results.length} match`, '',
  '| case | outcome | detail |', '|---|---|---|',
  ...results.map(r => `| ${r.id} | ${r.outcome} | ${r.detail.replaceAll('|', '\\|')} |`), '',
].join('\n');
console.log(summary);
for (const r of results.filter(x => x.outcome === 'fail' || (x.outcome !== 'match' && x.sql))) {
  console.log(`--- ${r.id} (${r.file})\n${r.query}\n--- SQL\n${r.sql}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
for (const b of bad) console.log(`::error::${b}`);
process.exit(bad.length ? 1 : 0);
