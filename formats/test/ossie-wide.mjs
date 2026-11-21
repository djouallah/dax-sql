// Apache Ossie's wide table compliance cases (compliance/wide_table in an Ossie checkout) that
// return rows, each by its Layer 2 query (`query.ossie.sql`, the Relational Query Interface query
// its Section 5 lowering gives), answered by dax-sql: .github/workflows/ossie-query.yml.
//   node formats/test/ossie-wide.mjs <ossie checkout>
// `expected.txt` names the fixture (`# fixture: <name>`: its SQL loaded into DuckDB, its model
// read with formats/ossie.js) and holds the rows, as an ost table. The e* cases, which raise a
// Layer 3 error for a JSON query, have no Layer 2 query: dax-sql takes no Layer 3 JSON, and they
// are counted as skipped. Rows are compared as ossie-compare.mjs does. A case that does not
// match fails the run, unless on PENDING; one on PENDING that matches must leave it.
import { readFileSync, readdirSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { parse } from 'yaml';
import { createCompiler } from '../../src/index.js';
import { ossieToModel } from '../ossie.js';
import { table, ordered, compare, rows } from './ossie-compare.mjs';

const PENDING = new Set([]);

const ossie = process.argv[2];
if (!ossie) throw new Error('usage: ossie-wide.mjs <ossie checkout>');
const dir = join(ossie, 'compliance', 'wide_table');
const FIXTURES = {
  retail: ['retail/retail.sql', 'retail/retail_model.ossie.yaml'],
  stores: ['stores/stores.sql', 'stores/stores_model.ossie.yaml'],
  stores_ambiguous: ['stores/stores.sql', 'stores/stores_ambiguous_model.ossie.yaml'],
};
const text = p => readFileSync(join(dir, p), 'utf8').replace(/\r\n/g, '\n');

// One DuckDB and compiler per fixture.
const fixtures = new Map();
async function fixture(name) {
  if (fixtures.has(name)) return fixtures.get(name);
  const [sql, model] = FIXTURES[name] ?? [];
  if (!sql) throw new Error(`unknown fixture ${name}`);
  const db = await DuckDBInstance.create(':memory:');
  const con = await db.connect();
  await con.run(text(sql));
  const doc = parse(text(model));
  const f = { con, name: doc.name, dax: createCompiler(ossieToModel(doc)) };
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

const cases = readdirSync(join(dir, 'cases')).filter(d => existsSync(join(dir, 'cases', d, 'expected.txt'))).sort();
if (!cases.length) { console.log(`::error::no wide table cases in ${dir}`); process.exit(1); }
const results = [];
for (const name of cases) {
  const at = `cases/${name}`;
  const id = name.split('_')[0].toUpperCase();
  if (!existsSync(join(dir, at, 'query.ossie.sql'))) { results.push({ id, name, outcome: 'skipped', detail: 'no Layer 2 query' }); continue; }
  const expectedText = text(`${at}/expected.txt`);
  const fx = expectedText.match(/^# fixture: (\S+)/m)?.[1];
  const query = text(`${at}/query.ossie.sql`).trim();
  let outcome, detail = '', sql = null;
  try {
    if (!fx) throw new Error('expected.txt names no fixture');
    const f = await fixture(fx);
    sql = compileCase(f, query);
    const got = await rows(f.con, sql);
    const diff = compare(got, table(expectedText.split('\n')), ordered(query), { round: true });
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
