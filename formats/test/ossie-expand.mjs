// dax-sql's Ossie SQL against Apache Ossie's view expander (ost/src/ossie_ost/expander.py,
// on its main), on a grid of queries no one wrote the answers of: .github/workflows/ossie-query.yml.
//   node formats/test/ossie-expand.mjs <ossie checkout> <expander checkout> [--python "<command>"] [--only <model>] [--report <file>]
// The expander turns a query over a model's datasets into plain DuckDB SQL over their sources, by
// the reference evaluation strategy of the Relational Query Interface (Section 9): an oracle. Each
// query is answered twice on the same DuckDB, by the expander's SQL and by dax-sql's, and the rows
// compared (ossie-compare.mjs, numbers within 1e-9).
// The models: SCOTT (compliance/query), retail and stores (compliance/wide_table), and every model
// in conformance/models written as Ossie (tmslToOssie), its CSV data loaded as the datasets'
// sources. The grid, per model, from its datasets' metrics in SQL and fields that are a column:
// totals, groups, WHERE (=, IN, NOT, ranges, IS NULL, OR) before AGG, HAVING, ORDER BY + LIMIT,
// GROUP BY ALL and ROLLUP, a CTE and a derived table, scalar operators over AGG values; and along
// each relationship, inner and outer joins both ways, filters on either side, the one side's
// measures counted once, chasm traps (two facts on one dimension) and snowflakes (a chain).
// Values come from the data, chosen with a fixed seed: the grid is the same on every run.
// Outcomes:
//   match;
//   fail: other rows, always a failure;
//   gap: dax-sql refuses or errs where the expander answers; a failure unless GAPS says why
//     (a GAPS entry no query hits must leave the list);
//   blank row: by design (README, no blank row), the rows but an outer join's group of facts
//     whose key the dimension lacks;
//   skipped: the expander cannot expand the query (its own limits) or its SQL does not run.
// --report: every query, its outcome and both SQLs, as JSON. --only: one model.
// --python: the command that runs Python with the expander importable (default: uv run --quiet
// --project <expander>/ost python).
import { readFileSync, readdirSync, existsSync, appendFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DuckDBInstance } from '@duckdb/node-api';
import { parse, stringify } from 'yaml';
import { createCompiler } from '../../src/index.js';
// DAXSQL_OPTIMIZE=0: the SQL with none of the emitter's rewrites (CI runs this both ways).
const OPTIMIZE = process.env.DAXSQL_OPTIMIZE === '0' ? { optimize: false } : {};
import { ossieToModel, tmslToOssie } from '../ossie.js';
import { sqlName, sourceColumnOf } from '../ossie-sql.js';
import { ordered, compare, rows, norm } from './ossie-compare.mjs';

// What dax-sql does not answer yet, by its error: { error: RegExp, why }.
const GAPS = [];

const PER_MODEL = 400;
const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i < 0 ? null : args.splice(i, 2)[1]; };
const python = opt('--python');
const only = opt('--only');
const report = opt('--report');
const [ossie, expander] = args;
if (!ossie || !expander) throw new Error('usage: ossie-expand.mjs <ossie checkout> <expander checkout> [--python "<command>"] [--only <model>] [--report <file>]');
const repo = fileURLToPath(new URL('../../', import.meta.url));
const read = p => readFileSync(p, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');

// --- the models ----------------------------------------------------------------------------

const DUCK_TYPE = { int64: 'BIGINT', double: 'DOUBLE', decimal: 'DECIMAL(18,4)', string: 'VARCHAR', boolean: 'BOOLEAN' };
const lit = s => `'${String(s).replace(/'/g, "''")}'`;
const ident = s => `"${String(s).replace(/"/g, '""')}"`;

function models() {
  const out = [];
  const fixture = (label, sql, yaml) => ({ label, yaml: read(yaml), load: con => con.run(read(sql)) });
  const q = join(ossie, 'compliance', 'query', 'scott');
  out.push(fixture('scott', join(q, 'scott.sql'), join(q, 'scott_model.ossie.yaml')));
  const w = join(ossie, 'compliance', 'wide_table');
  out.push(fixture('retail', join(w, 'retail', 'retail.sql'), join(w, 'retail', 'retail_model.ossie.yaml')));
  out.push(fixture('stores', join(w, 'stores', 'stores.sql'), join(w, 'stores', 'stores_model.ossie.yaml')));
  const dir = join(repo, 'conformance', 'models');
  for (const m of readdirSync(dir).filter(m => existsSync(join(dir, m, 'model.bim'))).sort()) {
    const bim = JSON.parse(read(join(dir, m, 'model.bim')));
    const doc = tmslToOssie(bim, m);
    out.push({
      label: m, yaml: stringify(doc, { lineWidth: 0 }),
      // The adapter's types (conformance/engines/dax-sql/adapter.mjs), each table as its dataset's source.
      async load(con) {
        for (const t of bim.model.tables) {
          const s = t.partitions?.[0]?.source;
          const ds = doc.datasets.find(d => d.name === t.name);
          const file = join(dir, m, 'data', `${s?.entityName}.csv`);
          if (s?.type !== 'entity' || !ds || !existsSync(file)) continue;
          const text = read(file);
          const cols = t.columns.filter(c => !c.type || c.type === 'data');
          const columns = cols.map(c => `${lit(c.sourceColumn ?? c.name)}: ${lit(c.dataType === 'dateTime'
            ? (/\d{4}-\d\d-\d\d[ T]\d/.test(text) ? 'TIMESTAMP' : 'DATE') : DUCK_TYPE[c.dataType] ?? 'VARCHAR')}`);
          await con.run(`CREATE TABLE ${ident(ds.source)} AS SELECT * FROM read_csv(${lit(file)}, header = true, columns = {${columns.join(', ')}}, nullstr = '', allow_quoted_nulls = false, quote = '"', escape = '"')`);
        }
      },
    });
  }
  return only ? out.filter(m => m.label === only) : out;
}

// --- the grid ------------------------------------------------------------------------------

// A seeded choice: the same grid on every run.
function prng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const sqlOf = e => e?.sql ?? e?.dialects?.find(d => d.dialect === 'OSSIE_SQL_2026' || d.dialect === 'ANSI_SQL')?.expression ?? null;

function literal(v) {
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? `DATE '${iso.slice(0, 10)}'` : `TIMESTAMP '${iso.slice(0, 19).replace('T', ' ')}'`;
  }
  const n = norm(v);
  if (typeof n === 'number') return String(n);
  if (n === 'true' || n === 'false') return n.toUpperCase();
  return lit(n);
}

// What the grid is made of: each dataset with data, its metrics in SQL, its fields that are a
// column, with their values; the relationships between such datasets.
async function shape(con, doc) {
  const tables = new Set((await rows(con, `SELECT table_schema, table_name FROM information_schema.tables`)).rows.map(([s, t]) => `${s}.${t}`.toLowerCase()));
  const has = src => tables.has(src.toLowerCase()) || tables.has(`main.${src}`.toLowerCase());
  const datasets = [];
  for (const d of doc.datasets ?? []) {
    if (!d.source || !has(d.source)) continue;
    const src = d.source.includes('.') ? d.source.split('.').map(ident).join('.') : ident(d.source);
    const metrics = (d.metrics ?? []).filter(m => sqlOf(m.expression) && !/\bAGG\s*\(/i.test(sqlOf(m.expression))).map(m => m.name);
    const fields = [];
    for (const f of d.fields ?? []) {
      const col = sourceColumnOf(sqlOf(f.expression) ?? '');
      if (!col || col.toLowerCase() !== f.name.toLowerCase()) continue;
      try {
        const [[n, nulls]] = (await rows(con, `SELECT COUNT(DISTINCT ${ident(col)}), COUNT(*) - COUNT(${ident(col)}) FROM ${src}`)).rows;
        const values = (await rows(con, `SELECT DISTINCT ${ident(col)} FROM ${src} WHERE ${ident(col)} IS NOT NULL ORDER BY 1 LIMIT 500`)).rows.map(r => r[0]);
        const kind = values.length ? (values[0] instanceof Date ? 'date' : typeof norm(values[0]) === 'number' ? 'number' : 'text') : 'text';
        fields.push({ name: f.name, n: Number(n), nulls: Number(nulls), values, kind, float: f.datatype === 'Float' });
      } catch { /* a column the source does not have */ }
    }
    if (!fields.length) continue;
    // A row identity for the expander, which joins by one: the dataset's key, or else all its
    // fields when its rows are distinct.
    let key = d.primary_key ?? null;
    if (!key?.length) {
      const cols = fields.map(f => ident(f.name)).join(', ');
      const [[all, distinct]] = (await rows(con, `SELECT (SELECT COUNT(*) FROM ${src}), (SELECT COUNT(*) FROM (SELECT DISTINCT ${cols} FROM ${src}))`)).rows;
      key = Number(all) === Number(distinct) ? fields.map(f => f.name) : null;
    }
    datasets.push({ name: d.name, metrics, fields, key });
  }
  const byName = new Map(datasets.map(d => [d.name, d]));
  const rels = (doc.relationships ?? []).filter(r => byName.has(r.from) && byName.has(r.to)
    && r.from_columns?.every(c => byName.get(r.from).fields.some(f => f.name === c))
    && r.to_columns?.every(c => byName.get(r.to).fields.some(f => f.name === c)));
  return { datasets, byName, rels };
}

// The model as the expander reads it: what it cannot read yet left out, which the grid does not
// ask for. Each field that is a column, its expression its name (the expander compares the
// two as text: "date" is not date); the metrics in SQL; a row identity for every dataset.
function forExpander(doc, { datasets, byName, rels }) {
  return stringify({
    ...doc,
    datasets: datasets.map(d => {
      const src = doc.datasets.find(x => x.name === d.name);
      const keep = new Set(d.fields.map(f => f.name));
      return {
        ...src,
        ...(d.key ? { primary_key: d.key } : {}),
        fields: src.fields.filter(f => keep.has(f.name)).map(f => ({ ...f, expression: { sql: f.name } })),
        metrics: (src.metrics ?? []).filter(m => d.metrics.includes(m.name)),
      };
    }),
    relationships: rels,
    metrics: undefined,
  }, { lineWidth: 0 });
}

function grid(model, { datasets, byName, rels }, seed) {
  const rand = prng(seed);
  const pick = xs => xs[Math.floor(rand() * xs.length)];
  const N = s => sqlName(s);
  const rel = d => `${N(model)}.${N(d)}`;
  const groupable = d => d.fields.filter(f => f.n >= 1 && f.n <= 25 && !f.float);
  const filterable = d => d.fields.filter(f => f.n >= 2);
  const val = f => literal(pick(f.values));
  // A condition on field f of alias a, of one of several forms.
  function cond(a, f) {
    const c = `${a}.${N(f.name)}`;
    const forms = [() => `${c} = ${val(f)}`, () => `${c} <> ${val(f)}`, () => `${c} IN (${val(f)}, ${val(f)})`,
      () => `NOT (${c} = ${val(f)})`, () => `${c} IS NOT NULL`];
    if (f.nulls) forms.push(() => `${c} IS NULL`);
    if (f.kind !== 'text') forms.push(() => `${c} >= ${val(f)}`, () => `${c} < ${val(f)}`, () => `${c} BETWEEN ${literal(f.values[0])} AND ${val(f)}`);
    return pick(forms)();
  }
  const out = [];
  const add = (template, sql) => { if (!out.some(q => q.sql === sql)) out.push({ template, sql }); };

  for (const d of datasets.filter(x => x.metrics.length)) {
    const gs = groupable(d), fs = filterable(d), ms = d.metrics;
    const m = () => N(pick(ms));
    for (const mm of ms) add('total', `SELECT AGG(${N(mm)}) AS v FROM ${rel(d.name)}`);
    for (let i = 0; i < 6 && gs.length; i++) {
      const g = N(pick(gs).name);
      add('group', `SELECT t.${g}, AGG(t.${m()}) AS v FROM ${rel(d.name)} AS t GROUP BY t.${g}`);
      if (ms.length > 1) add('two metrics', `SELECT t.${g}, AGG(t.${m()}) AS a, AGG(t.${m()}) AS b FROM ${rel(d.name)} AS t GROUP BY t.${g}`);
      const g2 = N(pick(gs).name);
      if (g2 !== g) add('two groups', `SELECT t.${g}, t.${g2}, AGG(t.${m()}) AS v FROM ${rel(d.name)} AS t GROUP BY t.${g}, t.${g2}`);
      if (fs.length) {
        add('where', `SELECT t.${g}, AGG(t.${m()}) AS v FROM ${rel(d.name)} AS t WHERE ${cond('t', pick(fs))} GROUP BY t.${g}`);
        add('where and', `SELECT t.${g}, AGG(t.${m()}) AS v FROM ${rel(d.name)} AS t WHERE ${cond('t', pick(fs))} AND ${cond('t', pick(fs))} GROUP BY t.${g}`);
        add('where or', `SELECT t.${g}, AGG(t.${m()}) AS v FROM ${rel(d.name)} AS t WHERE ${cond('t', pick(fs))} OR ${cond('t', pick(fs))} GROUP BY t.${g}`);
        add('where total', `SELECT AGG(t.${m()}) AS v FROM ${rel(d.name)} AS t WHERE ${cond('t', pick(fs))}`);
      }
      add('having', `SELECT t.${g}, AGG(t.${m()}) AS v FROM ${rel(d.name)} AS t GROUP BY t.${g} HAVING AGG(t.${m()}) > 0`);
      add('having null', `SELECT t.${g}, AGG(t.${m()}) AS v FROM ${rel(d.name)} AS t GROUP BY t.${g} HAVING AGG(t.${m()}) IS NOT NULL`);
      add('order limit', `SELECT t.${g}, AGG(t.${m()}) AS v FROM ${rel(d.name)} AS t GROUP BY t.${g} ORDER BY t.${g} NULLS FIRST LIMIT 3`);
      add('order by measure', `SELECT t.${g}, AGG(t.${m()}) AS v FROM ${rel(d.name)} AS t GROUP BY t.${g} ORDER BY v DESC NULLS LAST, t.${g} NULLS FIRST`);
      add('group by all', `SELECT t.${g}, AGG(t.${m()}) AS v FROM ${rel(d.name)} AS t GROUP BY ALL`);
      // Of a field with no NULL: the subtotal is the one row whose group is NULL.
      const whole = gs.filter(f => !f.nulls);
      if (whole.length) {
        const k = N(pick(whole).name);
        add('rollup', `SELECT t.${k}, AGG(t.${m()}) AS v FROM ${rel(d.name)} AS t GROUP BY ROLLUP (t.${k}) ORDER BY t.${k} NULLS LAST`);
      }
      const x = m();
      add('scalar ops', `SELECT t.${g}, AGG(t.${x}) * 2 AS a, AGG(t.${x}) + 1 AS b, COALESCE(AGG(t.${x}), 0) AS c FROM ${rel(d.name)} AS t GROUP BY t.${g}`);
      if (ms.length > 1) add('ratio', `SELECT t.${g}, CAST(AGG(t.${m()}) AS DOUBLE) / NULLIF(AGG(t.${m()}), 0) AS r FROM ${rel(d.name)} AS t GROUP BY t.${g}`);
      if (fs.length) {
        const mm = m();
        add('cte', `WITH s AS (SELECT ${g}, ${mm} AS mm FROM ${rel(d.name)} WHERE ${cond(rel(d.name), pick(fs)).replace(`${rel(d.name)}.`, '')}) SELECT ${g}, AGG(mm) AS v FROM s GROUP BY ${g}`);
      }
      add('derived table', `SELECT s.${g}, s.v FROM (SELECT t.${g}, AGG(t.${m()}) AS v FROM ${rel(d.name)} AS t GROUP BY t.${g}) AS s WHERE s.v IS NOT NULL`);
    }
  }

  // Joins, along each relationship: f the many side (from), o the one side (to).
  const on = (r, a, b) => r.from_columns.map((c, i) => `${a}.${N(c)} = ${b}.${N(r.to_columns[i])}`).join(' AND ');
  for (const r of rels) {
    const F = byName.get(r.from), O = byName.get(r.to);
    const og = groupable(O), fg = groupable(F), of = filterable(O), ff = filterable(F);
    for (let i = 0; i < 3; i++) {
      const join = pick(['JOIN', 'LEFT JOIN']);
      if (F.metrics.length && og.length) {
        const g = N(pick(og).name);
        add('star', `SELECT o.${g}, AGG(f.${N(pick(F.metrics))}) AS v FROM ${rel(F.name)} AS f ${join} ${rel(O.name)} AS o ON ${on(r, 'f', 'o')} GROUP BY o.${g}`);
        if (of.length) add('star where one', `SELECT o.${g}, AGG(f.${N(pick(F.metrics))}) AS v FROM ${rel(F.name)} AS f ${join} ${rel(O.name)} AS o ON ${on(r, 'f', 'o')} WHERE ${cond('o', pick(of))} GROUP BY o.${g}`);
        if (ff.length) add('star where many', `SELECT o.${g}, AGG(f.${N(pick(F.metrics))}) AS v FROM ${rel(F.name)} AS f ${join} ${rel(O.name)} AS o ON ${on(r, 'f', 'o')} WHERE ${cond('f', pick(ff))} GROUP BY o.${g}`);
        if (fg.length) {
          const h = N(pick(fg).name);
          add('star two sides', `SELECT o.${g}, f.${h}${h === g ? ' AS many_side' : ''}, AGG(f.${N(pick(F.metrics))}) AS v FROM ${rel(F.name)} AS f ${join} ${rel(O.name)} AS o ON ${on(r, 'f', 'o')} GROUP BY o.${g}, f.${h}`);
        }
        add('star total', `SELECT AGG(f.${N(pick(F.metrics))}) AS v FROM ${rel(F.name)} AS f ${join} ${rel(O.name)} AS o ON ${on(r, 'f', 'o')}`);
      }
      if (O.metrics.length && F.metrics.length && og.length) {
        const g = N(pick(og).name);
        add('one side counted once', `SELECT o.${g}, AGG(f.${N(pick(F.metrics))}) AS a, AGG(o.${N(pick(O.metrics))}) AS b FROM ${rel(F.name)} AS f ${join} ${rel(O.name)} AS o ON ${on(r, 'f', 'o')} GROUP BY o.${g}`);
        add('one to many', `SELECT o.${g}, AGG(o.${N(pick(O.metrics))}) AS a, AGG(f.${N(pick(F.metrics))}) AS b FROM ${rel(O.name)} AS o LEFT JOIN ${rel(F.name)} AS f ON ${on(r, 'f', 'o')} GROUP BY o.${g}`);
      }
      if (O.metrics.length && fg.length) {
        const g = N(pick(fg).name);
        add('fan-out', `SELECT f.${g}, AGG(o.${N(pick(O.metrics))}) AS v FROM ${rel(F.name)} AS f ${join} ${rel(O.name)} AS o ON ${on(r, 'f', 'o')} GROUP BY f.${g}`);
      }
    }
  }
  // Two facts on one dimension (a chasm trap), and a chain of two (a snowflake).
  for (const r1 of rels) {
    for (const r2 of rels) {
      if (r1 === r2) continue;
      const O = byName.get(r1.to);
      if (r2.to === r1.to && r1.from !== r2.from && r1.from < r2.from) {
        const A = byName.get(r1.from), B = byName.get(r2.from), og = groupable(O);
        if (A.metrics.length && B.metrics.length && og.length) {
          const g = N(pick(og).name);
          add('chasm', `SELECT o.${g}, AGG(a.${N(pick(A.metrics))}) AS x, AGG(b.${N(pick(B.metrics))}) AS y FROM ${rel(O.name)} AS o LEFT JOIN ${rel(A.name)} AS a ON ${on(r1, 'a', 'o')} LEFT JOIN ${rel(B.name)} AS b ON ${on(r2, 'b', 'o')} GROUP BY o.${g}`);
        }
      }
      if (r2.from === r1.to && r2.to !== r1.from && r1.from !== r1.to && r2.from !== r2.to) {
        const F = byName.get(r1.from), T = byName.get(r2.to), tg = groupable(T);
        if (F.metrics.length && tg.length) {
          const g = N(pick(tg).name);
          add('snowflake', `SELECT c.${g}, AGG(f.${N(pick(F.metrics))}) AS v FROM ${rel(F.name)} AS f JOIN ${rel(O.name)} AS b ON ${on(r1, 'f', 'b')} JOIN ${rel(T.name)} AS c ON ${on(r2, 'b', 'c')} GROUP BY c.${g}`);
        }
      }
    }
  }
  // At most PER_MODEL, chosen evenly over the templates.
  if (out.length <= PER_MODEL) return out;
  const by = Object.groupBy(out, q => q.template);
  const lists = Object.values(by);
  const kept = [];
  for (let i = 0; kept.length < PER_MODEL; i++) for (const l of lists) if (l[i] && kept.length < PER_MODEL) kept.push(l[i]);
  return kept;
}

// --- running -------------------------------------------------------------------------------

function expandAll(requests) {
  const tmp = mkdtempSync(join(tmpdir(), 'ossie-expand-'));
  const file = join(tmp, 'in.jsonl');
  writeFileSync(file, requests.map(r => JSON.stringify(r)).join('\n') + '\n');
  const script = join(repo, 'formats', 'test', 'ossie_expand.py');
  const cmd = python ?? `uv run --quiet --project "${join(expander, 'ost')}" python`;
  const r = spawnSync(`${cmd} "${script}"`, { shell: true, input: readFileSync(file), maxBuffer: 1 << 30, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`the expander did not run (${r.status}): ${r.stderr}`);
  const lines = r.stdout.trim().split('\n').map(l => JSON.parse(l));
  if (lines.length !== requests.length) throw new Error(`the expander answered ${lines.length} of ${requests.length}: ${r.stderr}`);
  return lines;
}

// A grid query's groups that are columns of a relation an outer join adds (`LEFT JOIN x AS o`):
// the positions, among the SELECT items before the first AGG, of those named `o.`.
function paddedGroups(sql) {
  const added = [...sql.matchAll(/\bLEFT JOIN\s+.+?\s+AS\s+(\w+)\s+ON\b/gi)].map(m => m[1]);
  const list = sql.slice(sql.search(/\bSELECT\b/i) + 6, sql.search(/\bFROM\b/i));
  const items = [];
  let depth = 0, item = '';
  for (const c of list + ',') {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && !depth) { if (/\bAGG\s*\(/i.test(item)) break; items.push(item.trim()); item = ''; } else item += c;
  }
  return items.map((it, i) => (added.some(a => it.startsWith(`${a}.`)) ? i : -1)).filter(i => i >= 0);
}

function compileCase(dax, model, q) {
  try {
    return dax.compile(q).sql;
  } catch (e) {
    let st = null;
    try { st = dax.compileStatement(q, model); } catch { /* the first error says more */ }
    if (st?.relations?.length) return st.sql;
    throw e;
  }
}

const results = [];
const loaded = [];
for (const [i, m] of models().entries()) {
  const db = await DuckDBInstance.create(':memory:');
  const con = await db.connect();
  await m.load(con);
  const doc = parse(m.yaml);
  const sh = await shape(con, doc);
  // The row identity the expander is given (shape), dax-sql's too: one model for both.
  for (const d of doc.datasets ?? []) {
    const key = sh.byName.get(d.name)?.key;
    if (!d.primary_key?.length && key) d.primary_key = key;
  }
  let dax;
  try {
    dax = createCompiler(ossieToModel(doc), OPTIMIZE);
  } catch (e) {
    results.push({ model: m.label, id: `${m.label}: the model`, template: 'model', sql: '', outcome: 'gap', detail: e.message.split('\n')[0] });
    continue;
  }
  loaded.push({ m, con, dax, doc, queries: grid(doc.name, sh, 1000 + i), expanderYaml: forExpander(doc, sh) });
}
const requests = loaded.flatMap(({ doc, expanderYaml, queries }) => [{ model: doc.name, yaml: expanderYaml }, ...queries.map(q => ({ sql: q.sql }))]);
const answers = expandAll(requests);
let at = 0;
for (const { m, con, dax, doc, queries } of loaded) {
  const def = answers[at++];
  for (const [k, q] of queries.entries()) {
    const ans = answers[at++];
    const r = { model: m.label, id: `${m.label}#${k + 1}`, template: q.template, sql: q.sql };
    results.push(r);
    if (def.error) { Object.assign(r, { outcome: 'skipped', detail: `the expander does not read the model: ${def.error}` }); continue; }
    if (ans.error) { Object.assign(r, { outcome: 'skipped', detail: `expander: ${ans.error}` }); continue; }
    let want;
    try { want = await rows(con, ans.sql); } catch (e) { Object.assign(r, { outcome: 'skipped', detail: `the expansion does not run: ${e.message.split('\n')[0]}`, expansion: ans.sql }); continue; }
    r.expansion = ans.sql;
    try {
      r.ours = compileCase(dax, doc.name, q.sql);
      const got = await rows(con, r.ours);
      const diff = compare(got, want, ordered(q.sql));
      Object.assign(r, { outcome: diff ? 'fail' : 'match', detail: diff ?? '' });
      // By design, no blank row (README): an outer join's group of fact rows whose key the
      // dimension lacks (or is NULL), its columns of the dimension all NULL, is not there. The
      // rest must be the expander's rows.
      const padded = diff ? paddedGroups(q.sql) : [];
      if (padded.length) {
        const kept = { ...want, rows: want.rows.filter(w => !padded.every(i => w[i] === null || w[i] === undefined)) };
        if (kept.rows.length < want.rows.length && !compare(got, kept, ordered(q.sql))) Object.assign(r, { outcome: 'blank row', detail: diff });
      }
    } catch (e) {
      Object.assign(r, { outcome: 'gap', detail: `${e.code ? `${e.code}: ` : ''}${e.message.split('\n')[0]}` });
    }
  }
}

// --- the report ----------------------------------------------------------------------------

const bad = [];
const hit = new Set();
for (const r of results) {
  if (r.outcome === 'fail') bad.push(`${r.id} (${r.template}): wrong rows: ${r.detail}`);
  if (r.outcome === 'gap') {
    const g = GAPS.find(x => x.error.test(r.detail));
    if (g) hit.add(g); else bad.push(`${r.id} (${r.template}): ${r.detail}`);
  }
}
for (const g of GAPS) if (!hit.has(g)) bad.push(`GAPS ${g.error} matches no query now: take it off`);

const labels = [...new Set(results.map(r => r.model))];
const count = (rs, o) => rs.filter(r => r.outcome === o).length;
const summary = [
  `### dax-sql against Ossie's view expander: ${count(results, 'match')} of ${results.length - count(results, 'skipped')} match (${count(results, 'blank row')} no blank row, by design; ${count(results, 'skipped')} the expander does not answer)`, '',
  '| model | queries | match | fail | gap | blank row | skipped |', '|---|---|---|---|---|---|---|',
  ...labels.map(l => { const rs = results.filter(r => r.model === l); return `| ${l} | ${rs.length} | ${count(rs, 'match')} | ${count(rs, 'fail')} | ${count(rs, 'gap')} | ${count(rs, 'blank row')} | ${count(rs, 'skipped')} |`; }),
  '', '| template | match | fail | gap | blank row | skipped |', '|---|---|---|---|---|---|',
  ...[...new Set(results.map(r => r.template))].map(t => { const rs = results.filter(r => r.template === t); return `| ${t} | ${count(rs, 'match')} | ${count(rs, 'fail')} | ${count(rs, 'gap')} | ${count(rs, 'blank row')} | ${count(rs, 'skipped')} |`; }),
  '',
].join('\n');
console.log(summary);
const skips = Object.entries(Object.groupBy(results.filter(r => r.outcome === 'skipped'), r => r.detail.replace(/'[^']*'|"[^"]*"/g, '…'))).sort((a, b) => b[1].length - a[1].length);
console.log('Skipped, by why:');
for (const [why, rs] of skips) console.log(`  ${rs.length}  ${why}`);
for (const r of results.filter(x => x.outcome === 'fail' || x.outcome === 'gap')) {
  let daxText;
  try { daxText = loaded.find(l => l.m.label === r.model).dax.sqlToDax(r.sql).dax; } catch (e) { daxText = `(${e.message.split('\n')[0]})`; }
  r.dax = daxText;
  console.log(`\n--- ${r.id} (${r.template}): ${r.outcome}: ${r.detail}\n${r.sql}\n--- DAX\n${daxText}\n--- dax-sql's SQL\n${r.ours ?? '(none)'}\n--- the expansion\n${r.expansion ?? '(none)'}`);
}
if (report) writeFileSync(report, JSON.stringify(results, null, 1));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
for (const b of bad) console.log(`::error::${b}`);
process.exit(bad.length ? 1 : 0);
