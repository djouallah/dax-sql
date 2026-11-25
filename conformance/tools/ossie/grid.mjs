// Apache Ossie's view expander's grid of queries (formerly formats/test/ossie-expand.mjs), as
// tools/ossie/build.mjs writes them for Power BI: per model, its datasets' metrics in SQL and
// fields that are a column, with values from its data under a fixed seed: totals, groups, WHERE
// (=, IN, NOT, ranges, IS NULL, OR) before AGG, HAVING, ORDER BY + LIMIT, GROUP BY ALL and ROLLUP,
// a CTE and a derived table, scalar operators over AGG values; and along each relationship,
// inner and outer joins both ways, filters on either side, the one side's measures counted once,
// chasm traps and snowflakes.
//   models(ossie)   SCOTT, retail and stores (an Ossie checkout's), and every model in models/
//                   written as Ossie (tmslToOssie), each { label, yaml, load(con) }
//   shape(con, doc) what the grid is made of;  grid(model, shape, seed)  its queries
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { tmslToOssie } from '../../../formats/ossie.js';
import { sqlName, sourceColumnOf } from '../../../formats/ossie-sql.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const read = p => readFileSync(p, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
// At most this many queries a model.
const PER_MODEL = 400;

// A value as null, a number, or text.
export function norm(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return String(v);
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.replace('T', ' ').replace(/\.000Z$/, '').replace(/Z$/, '');
  }
  if (typeof v === 'object' && 'toDouble' in v) return v.toDouble();
  if (typeof v === 'object') return String(v);
  return v;
}


// Rows of a DuckDB query, as compare() takes them.
export async function rows(con, sql) {
  const r = await con.runAndReadAll(sql);
  return { columns: r.columnNames(), rows: r.getRowsJS() };
}

const DUCK_TYPE = { int64: 'BIGINT', double: 'DOUBLE', decimal: 'DECIMAL(18,4)', string: 'VARCHAR', boolean: 'BOOLEAN' };
const lit = s => `'${String(s).replace(/'/g, "''")}'`;
const ident = s => `"${String(s).replace(/"/g, '""')}"`;

export function models(ossie) {
  const out = [];
  const fixture = (label, sql, yaml) => ({ label, yaml: read(yaml), load: con => con.run(read(sql)) });
  const q = join(ossie, 'compliance', 'query', 'scott');
  out.push(fixture('scott', join(q, 'scott.sql'), join(q, 'scott_model.ossie.yaml')));
  const w = join(ossie, 'compliance', 'wide_table');
  out.push(fixture('retail', join(w, 'retail', 'retail.sql'), join(w, 'retail', 'retail_model.ossie.yaml')));
  out.push(fixture('stores', join(w, 'stores', 'stores.sql'), join(w, 'stores', 'stores_model.ossie.yaml')));
  const dir = join(repo, 'conformance', 'models');
  // The models built from Ossie's (tools/ossie/build.mjs) are Ossie's own files, above.
  for (const m of readdirSync(dir).filter(m => existsSync(join(dir, m, 'model.bim')) && !out.some(o => o.label === m)).sort()) {
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
  return out;
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
export async function shape(con, doc) {
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

export function grid(model, { datasets, byName, rels }, seed) {
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

