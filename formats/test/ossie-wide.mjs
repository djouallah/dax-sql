// Apache Ossie's wide table compliance cases (compliance/wide_table in an Ossie checkout) that
// return rows, each by its Layer 2 query (the Relational Query Interface query its Section 5
// lowering gives), answered by dax-sql: .github/workflows/ossie-query.yml.
//   node formats/test/ossie-wide.mjs <ossie checkout>
// Each case is an .ost script: connect("<data>") (<data>/<data>.sql loaded into DuckDB),
// modelFile(name, "<path>") (read with formats/ossie.js), then executeLower(...) with the Layer 2
// query between {_| and |_} and the rows after it, as an ost table. The e* cases, which raise a
// Layer 3 error for a JSON query (`> error:`), have no Layer 2 query: dax-sql takes no Layer 3
// JSON, and they are counted as skipped. Rows are compared as ossie-compare.mjs does. A case that
// does not match fails the run, unless on PENDING; one on PENDING that matches must leave it.
import { readFileSync, readdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { parse } from 'yaml';
import { createCompiler } from '../../src/index.js';
// DAXSQL_OPTIMIZE=0: the SQL with none of the emitter's rewrites (CI runs this both ways).
const OPTIMIZE = process.env.DAXSQL_OPTIMIZE === '0' ? { optimize: false } : {};
import { ossieToModel } from '../ossie.js';
import { table, ordered, compare, rows } from './ossie-compare.mjs';

const PENDING = new Set([]);

const ossie = process.argv[2];
if (!ossie) throw new Error('usage: ossie-wide.mjs <ossie checkout>');
const dir = join(ossie, 'compliance', 'wide_table');
const text = p => readFileSync(join(dir, p), 'utf8').replace(/\r\n/g, '\n');

// One DuckDB and compiler per fixture: a case's data and model, `<data>|<model path>`.
const fixtures = new Map();
async function fixture(name) {
  if (fixtures.has(name)) return fixtures.get(name);
  const [data, model] = name.split('|');
  const sql = `${data}/${data}.sql`;
  const db = await DuckDBInstance.create(':memory:');
  const con = await db.connect();
  await con.run(text(sql));
  const doc = parse(text(model));
  const f = { con, name: doc.name, dax: createCompiler(ossieToModel(doc), OPTIMIZE) };
  fixtures.set(name, f);
  return f;
}

function compileCase(f, q) {
  try {
    return f.dax.compile(q).sql;
  } catch (e) {
    let st = null;
    try { st = f.dax.compileStatement(q, f.name); } catch { /* the first error says more */ }
    if (st?.relations?.length) return st.sql;
    throw e;
  }
}

const cases = readdirSync(dir).filter(f => f.endsWith('.ost')).sort();
if (!cases.length) { console.log(`::error::no wide table cases in ${dir}`); process.exit(1); }
const results = [];
for (const file of cases) {
  const name = file.slice(0, -4);
  const id = name.split('_')[0].toUpperCase();
  const src = text(file).split('\n').filter(l => !l.startsWith('#')).join('\n');
  const start = src.indexOf('{_|'), end = src.indexOf('|_}');
  if (/^> error:/m.test(src) || start < 0 || end < 0) { results.push({ id, name, outcome: 'skipped', detail: 'no Layer 2 query' }); continue; }
  const data = src.match(/connect\("([^"]+)"\)/)?.[1], model = src.match(/modelFile\("[^"]+",\s*"([^"]+)"\)/)?.[1];
  const fx = data && model ? `${data}|${model}` : null;
  const query = src.slice(start + 3, end).trim();
  const lines = src.slice(end).split('\n').slice(1);
  const stop = lines.findIndex(l => !l.startsWith('+') && !l.startsWith('|'));
  const expected = table(lines.slice(0, stop < 0 ? undefined : stop));
  let outcome, detail = '', sql = null;
  try {
    if (!fx) throw new Error('the case names no data or model');
    const f = await fixture(fx);
    sql = compileCase(f, query);
    const got = await rows(f.con, sql);
    const diff = compare(got, expected, ordered(query), { round: true });
    outcome = diff ? 'fail' : 'match';
    detail = diff ?? '';
  } catch (e) {
    outcome = e.code === 'UNSUPPORTED' ? 'unsupported' : 'error';
    detail = `${e.code ? `${e.code}: ` : ''}${e.message.split('\n')[0]}`;
  }
  results.push({ id, name, fx, query, outcome, detail, sql });
}

const bad = [];
for (const r of results) {
  if (r.outcome === 'skipped') continue;
  if (r.outcome === 'fail') bad.push(`${r.id}: wrong rows: ${r.detail}`);
  else if (r.outcome === 'match' && PENDING.has(r.id)) bad.push(`${r.id} matches now: take it off PENDING`);
  else if (r.outcome !== 'match' && !PENDING.has(r.id)) bad.push(`${r.id}: ${r.outcome}, ${r.detail}`);
}
const ids = new Set(results.map(r => r.id));
for (const id of PENDING) if (!ids.has(id)) bad.push(`${id} is on PENDING but no case has that id`);

const counts = Object.groupBy(results, r => r.outcome);
const asked = results.length - (counts.skipped?.length ?? 0);
const summary = [
  `### Ossie wide table compliance, Layer 2 queries: ${counts.match?.length ?? 0} of ${asked} match (${counts.skipped?.length ?? 0} error cases skipped)`, '',
  '| case | fixture | outcome | detail |', '|---|---|---|---|',
  ...results.filter(r => r.outcome !== 'skipped').map(r => `| ${r.name} | ${r.fx ?? ''} | ${r.outcome} | ${r.detail.replaceAll('|', '\\|')} |`), '',
].join('\n');
console.log(summary);
for (const r of results.filter(x => x.outcome !== 'match' && x.outcome !== 'skipped')) {
  let daxText;
  try { daxText = (await fixture(r.fx)).dax.sqlToDax(r.query).dax; } catch (e) { daxText = `(${e.message.split('\n')[0]})`; }
  console.log(`--- ${r.name}: ${r.outcome}\n${r.query}\n--- DAX\n${daxText}\n--- SQL\n${r.sql ?? '(none)'}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
for (const b of bad) console.log(`::error::${b}`);
process.exit(bad.length ? 1 : 0);
