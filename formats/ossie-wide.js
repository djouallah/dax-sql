// Apache Ossie's Wide Table Query Interface (Layer 3, core-spec/wide_table_semantics.md): a
// query as JSON ({ dimensions, metrics, filter }) over an Ossie model, checked in the order of
// its Section 8 and lowered as its Section 5 does, to the Layer 2 SQL it means, which dax-sql
// compiles as any SQL over the model.
//
//   wideToSql(doc, query)             -> { sql, doc }   the Layer 2 SQL, and the model with the
//                                                       measures the lowering adds (Section 5.2)
//   compileWide(doc, query, options)  -> { sql, layer2 } the engine's SQL (createCompiler(model,
//                                                       options).compileStatement)
//
// An error is a DaxError whose message starts with the code of Section 8 (`wide` holds it):
// E_INVALID_QUERY is SYNTAX, E_DEFERRED_WINDOWED_METRIC UNSUPPORTED, every other SEMANTIC.
import { DaxError } from '../src/errors.js';
import { parseSql } from '../src/sql.js';
import { createCompiler } from '../src/index.js';
import { ossieToModel } from './ossie.js';
import { sqlName } from './ossie-sql.js';

const fail = (wide, msg) => {
  const code = wide === 'E_INVALID_QUERY' ? 'SYNTAX' : wide === 'E_DEFERRED_WINDOWED_METRIC' ? 'UNSUPPORTED' : 'SEMANTIC';
  const e = new DaxError(`${wide}: ${msg}`, { code });
  e.wide = wide;
  throw e;
};
const lc = s => String(s).toLowerCase();
const AGGREGATES = new Set(['SUM', 'COUNT', 'AVG', 'MIN', 'MAX', 'AGG', 'MEDIAN', 'STDDEV', 'STDDEV_SAMP', 'STDDEV_POP',
  'VARIANCE', 'VAR_SAMP', 'VAR_POP', 'ANY_VALUE', 'LISTAGG', 'STRING_AGG', 'PERCENTILE_CONT', 'PERCENTILE_DISC', 'APPROX_COUNT_DISTINCT']);
const WINDOW = /\bOVER\s*\(/i;
// A window's OVER (...) taken out, so that what it is over can be read.
const withoutWindows = s => s.replace(/\bOVER\s*\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/gi, '');

// An expression of Layer 1, as a tree whose nodes know where they are in `text`.
const PREFIX = 'SELECT ';
function parse(text) {
  const q = parseSql(`${PREFIX}${text} FROM wide_table`);
  return q.select[0].e;
}
const at = n => [n.pos - PREFIX.length, n.pos - PREFIX.length + n.src.length];
function walk(n, f, inAgg = false) {
  if (!n || typeof n !== 'object') return;
  if (Array.isArray(n)) { n.forEach(x => walk(x, f, inAgg)); return; }
  if (f(n, inAgg) === false) return;
  const agg = n.k === 'call' && AGGREGATES.has(String(n.fn).toUpperCase());
  for (const [k, v] of Object.entries(n)) if (k !== 'pos' && k !== 'src' && v && typeof v === 'object') walk(v, f, inAgg || agg);
}
// `text` with each [from, to) of `edits` replaced by its text.
function splice(text, edits) {
  let out = text;
  for (const { from, to, by } of [...edits].sort((a, b) => b.from - a.from)) out = out.slice(0, from) + by + out.slice(to);
  return out;
}

// The model: its datasets (fields, metrics), its own metrics, its relationships as steps.
function index(doc) {
  const datasets = new Map();
  for (const d of doc.datasets ?? []) {
    datasets.set(lc(d.name), {
      name: d.name, def: d,
      fields: new Map((d.fields ?? []).map(f => [lc(f.name), f])),
      metrics: new Map((d.metrics ?? []).map(m => [lc(m.name), m])),
    });
  }
  const metrics = new Map((doc.metrics ?? []).map(m => [lc(m.name), m]));
  // A step from the many side to the one side; a relationship of a dataset to itself is none.
  const steps = (doc.relationships ?? []).filter(r => lc(r.from) !== lc(r.to)).map(r => ({
    from: lc(r.from), to: lc(r.to), on: (r.from_columns ?? []).map((c, i) => [c, (r.to_columns ?? [])[i]]),
  }));
  return { datasets, metrics, steps };
}
// The expression's SQL: its own, or an entry's (under `nonportable_dialects`, apache/ossie#817, or
// `dialects`).
const sqlOf = m => m?.expression?.sql ?? (m?.expression?.nonportable_dialects ?? m?.expression?.dialects ?? [])
  .find(d => /^(OSSIE_SQL_2026|ANSI_SQL)$/i.test(d?.dialect ?? ''))?.expression ?? null;

// Every path from dataset x to dataset y: steps with no dataset twice (the path to itself empty).
function paths(model, x, y) {
  const out = [];
  const go = (at, seen, path) => {
    if (at === y) { out.push(path); return; }
    for (const s of model.steps) if (s.from === at && !seen.has(s.to)) go(s.to, new Set([...seen, s.to]), [...path, s]);
  };
  go(x, new Set([x]), []);
  return out;
}

// A reference: `dataset.name` (a field or a dataset's metric) or `name` (the model's metric).
function resolve(model, ref) {
  const parts = String(ref).split('.');
  if (parts.length === 1) {
    const m = model.metrics.get(lc(parts[0]));
    return m ? { kind: 'metric', ds: null, name: m.name, def: m, ref } : null;
  }
  if (parts.length !== 2) return null;
  const d = model.datasets.get(lc(parts[0]));
  if (!d) return null;
  const f = d.fields.get(lc(parts[1]));
  if (f) return { kind: 'field', ds: lc(d.name), dataset: d.name, name: f.name, def: f, ref };
  const m = d.metrics.get(lc(parts[1]));
  if (m) return { kind: 'metric', ds: lc(d.name), dataset: d.name, name: m.name, def: m, ref };
  return null;
}

// Row 1: the query's shape (Section 3.7).
function entries(q, part, key) {
  const v = q[part];
  if (v === undefined) return [];
  if (!Array.isArray(v)) fail('E_INVALID_QUERY', `${part} must be an array`);
  return v.map(e => {
    if (typeof e === 'string') return { ref: e, alias: null };
    if (!e || typeof e !== 'object' || Array.isArray(e)) fail('E_INVALID_QUERY', `an entry of ${part} must be a string or an object`);
    for (const k of Object.keys(e)) if (k !== key && k !== 'alias') fail('E_INVALID_QUERY', `unsupported property "${k}" in ${part}`);
    if (typeof e[key] !== 'string') fail('E_INVALID_QUERY', `an entry of ${part} must have "${key}", a string`);
    if (e.alias !== undefined && (typeof e.alias !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(e.alias))) fail('E_INVALID_QUERY', `the alias of ${e[key]} must be an identifier`);
    return { ref: e[key], alias: e.alias ?? null };
  });
}

// The empty-input value of a dataset's measure (Section 5.2): its aggregates over no rows (a
// count 0, any other NULL), the rest of its expression as it is; null when that is NULL.
function emptyOf(model, ds, text, depth = 0) {
  if (depth > 8) return null;
  let tree;
  try { tree = parse(text); } catch { return null; }
  const edits = [];
  walk(tree, (n, inAgg) => {
    if (inAgg || n.k !== 'call' || !AGGREGATES.has(String(n.fn).toUpperCase())) return;
    const fn = String(n.fn).toUpperCase();
    let by = 'NULL';
    if (fn === 'COUNT' || fn === 'APPROX_COUNT_DISTINCT') by = '0';
    else if (fn === 'AGG' && n.args[0]?.k === 'name') {
      const p = n.args[0].parts, d = p.length === 2 ? model.datasets.get(lc(p[0])) : model.datasets.get(ds);
      const m = d?.metrics.get(lc(p[p.length - 1]));
      by = (m && emptyOf(model, lc(d.name), sqlOf(m) ?? '', depth + 1)) ?? 'NULL';
    }
    const [from, to] = at(n);
    edits.push({ from, to, by });
    return false;
  });
  const out = splice(text, edits).trim();
  return /^\(*\s*NULL\s*\)*$/i.test(out) ? null : out;
}

export function wideToSql(doc, query) {
  const model = index(doc);
  // 1. E_INVALID_QUERY
  if (!query || typeof query !== 'object' || Array.isArray(query)) fail('E_INVALID_QUERY', 'the query must be an object');
  for (const k of Object.keys(query)) if (!['dimensions', 'metrics', 'filter'].includes(k)) fail('E_INVALID_QUERY', `unsupported key "${k}"`);
  for (const k of ['dimensions', 'metrics']) if (query[k] === null) fail('E_INVALID_QUERY', `${k} must be an array`);
  if (query.filter === null || (query.filter !== undefined && typeof query.filter !== 'string')) fail('E_INVALID_QUERY', 'filter must be a string');
  const dims = entries(query, 'dimensions', 'field'), mets = entries(query, 'metrics', 'metric');
  const filter = query.filter ?? null;
  let filterTree = null, filterWindow = false;
  if (filter != null) {
    filterWindow = WINDOW.test(filter);
    try { filterTree = parse(filterWindow ? withoutWindows(filter) : filter); } catch (e) { fail('E_INVALID_QUERY', `the filter does not parse: ${e.message}`); }
  }
  // 2. E_EMPTY_AGGREGATION_QUERY
  if (!dims.length && !mets.length) fail('E_EMPTY_AGGREGATION_QUERY', 'the query has neither dimensions nor metrics');
  // 3. E_NAME_NOT_FOUND: the dimensions, the metrics, then the filter's references.
  for (const e of [...dims, ...mets]) {
    e.r = resolve(model, e.ref);
    if (!e.r) fail('E_NAME_NOT_FOUND', `${e.ref} does not resolve`);
  }
  const filterRefs = [];
  walk(filterTree, n => {
    if (n.k !== 'name') return;
    const ref = n.parts.join('.'), r = resolve(model, ref);
    if (!r) fail('E_NAME_NOT_FOUND', `${ref} does not resolve`);
    filterRefs.push(r);
  });
  // 4, 5. A metric as a dimension, a field as a metric.
  for (const e of dims) if (e.r.kind === 'metric') fail('E_METRIC_IN_DIMENSIONS', `dimension ${e.ref} is a metric`);
  for (const e of mets) if (e.r.kind === 'field') fail('E_FIELD_IN_METRICS', `metric ${e.ref} is a field`);
  // 6. An aggregate or a metric in the filter; 7. a window function there.
  if (filterTree) {
    let agg = filterRefs.some(r => r.kind === 'metric');
    walk(filterTree, n => { if (n.k === 'call' && AGGREGATES.has(String(n.fn).toUpperCase())) agg = true; });
    if (agg) fail('E_AGGREGATE_IN_WHERE', `filter has an aggregate: ${filter}`);
    if (filterWindow) fail('E_WINDOW_IN_WHERE', `filter has a window function: ${filter}`);
  }
  // 8. The filter's fields of one dataset at most.
  const filterSets = [...new Set(filterRefs.map(r => r.ds))];
  if (filterSets.length > 1) fail('E_CROSS_DATASET_FILTER', `filter reads datasets ${filterSets.map(d => model.datasets.get(d).name).join(', ')}: ${filter}`);
  const filterDs = filterSets[0] ?? null;
  // 9. Output names, unique.
  const names = new Map();
  for (const e of [...dims, ...mets]) {
    e.out = e.alias ?? String(e.ref).split('.').pop();
    const other = names.get(lc(e.out));
    if (other) fail('E_NAME_COLLISION', `${other.ref} and ${e.ref} have output name ${e.out}`);
    names.set(lc(e.out), e);
  }
  // 10-12. Each metric's components (Section 5.2): a dataset's metric is one, with its dataset
  // as home; in a model's metric, each aggregate is one, its home the one dataset it reads.
  const added = new Map();   // home -> [{ name, sql }]: the measures the lowering adds
  let n = 0;
  const modelMetrics = mets.filter(e => e.r.ds == null);
  const analyzed = new Map();
  for (const e of modelMetrics) {
    const text = sqlOf(e.r.def);
    if (text == null) fail('E_INVALID_QUERY', `metric ${e.ref} has no SQL expression`);
    const window = WINDOW.test(text), plain = window ? withoutWindows(text) : text;
    let tree;
    try { tree = parse(plain); } catch (err) { fail('E_INVALID_QUERY', `metric ${e.ref} does not parse: ${err.message}`); }
    const aggs = [], outside = [];
    walk(tree, (x, inAgg) => {
      if (x.k === 'name' && !inAgg) outside.push(x.parts.join('.'));
      if (!inAgg && x.k === 'call' && AGGREGATES.has(String(x.fn).toUpperCase())) aggs.push(x);
    });
    analyzed.set(e, { text: plain, window, aggs, outside });
  }
  for (const e of modelMetrics) {
    const a = analyzed.get(e);
    if (a.outside.length) fail('E_UNAGGREGATED_FINER_GRAIN_REFERENCE', `metric ${e.ref} has ${a.outside[0]} outside every aggregate`);
  }
  for (const e of modelMetrics) if (analyzed.get(e).window) fail('E_DEFERRED_WINDOWED_METRIC', `metric ${e.ref} has a window function`);
  for (const e of modelMetrics) {
    for (const x of analyzed.get(e).aggs) {
      const sets = [];
      walk(x.args, y => { if (y.k === 'name' && y.parts.length === 2 && !sets.includes(lc(y.parts[0]))) sets.push(lc(y.parts[0])); });
      if (sets.length !== 1) {
        fail('E_AMBIGUOUS_MEASURE_GRAIN', `in metric ${e.ref}, the arguments of ${x.src} read ${sets.length ? `datasets ${sets.map(d => model.datasets.get(d)?.name ?? d).join(', ')}` : 'no dataset'}`);
      }
      x.home = sets[0];
    }
  }
  for (const e of mets) {
    if (e.r.ds != null) { e.parts = [{ home: e.r.ds, measure: e.r.name, empty: emptyOf(model, e.r.ds, sqlOf(e.r.def) ?? '') }]; continue; }
    const a = analyzed.get(e);
    e.parts = a.aggs.map(x => {
      const home = x.home, [from, to] = at(x);
      if (String(x.fn).toUpperCase() === 'AGG' && x.args[0]?.k === 'name') {
        const m = model.datasets.get(home).metrics.get(lc(x.args[0].parts[1]));
        if (!m) fail('E_NAME_NOT_FOUND', `${x.args[0].parts.join('.')} does not resolve`);
        return { home, measure: m.name, empty: emptyOf(model, home, sqlOf(m) ?? ''), from, to };
      }
      // A measure of its home dataset: the aggregate with its fields named as that dataset's.
      const edits = [];
      walk(x, y => { if (y.k === 'name' && y.parts.length === 2) { const [f, t] = at(y); edits.push({ from: f - from, to: t - from, by: sqlName(y.parts[1]) }); } });
      const sql = splice(x.src, edits);
      const ds = model.datasets.get(home);
      let name;
      do name = `__c${++n}`; while (ds.fields.has(name) || ds.metrics.has(name));
      if (!added.has(home)) added.set(home, []);
      added.get(home).push({ name, sql });
      return { home, measure: name, empty: emptyOf(model, home, sql), from, to };
    });
    e.text = a.text;
  }
  // 13-17. Paths (Sections 5.3, 5.6, 4).
  const dsName = d => model.datasets.get(d).name;
  const homesOf = e => [...new Set(e.parts.map(p => p.home))];
  const reaches = (x, y) => paths(model, x, y).length > 0;
  const metricReaches = (e, y) => homesOf(e).every(h => reaches(h, y));
  let branches;   // [{ home, parts }]
  if (mets.length) {
    for (const d of dims) if (!mets.some(e => metricReaches(e, d.r.ds))) fail('E_NO_PATH', `metric ${mets[0].ref} does not reach ${dsName(d.r.ds)}, the dataset of dimension ${d.ref}, and nor does any other metric`);
    for (const d of dims) {
      const not = mets.find(e => !metricReaches(e, d.r.ds));
      if (not) fail('E_PARTIAL_DIMENSION_REACHABILITY', `metric ${not.ref} does not reach ${dsName(d.r.ds)}, the dataset of dimension ${d.ref}`);
    }
    if (filterDs) {
      const not = mets.find(e => !metricReaches(e, filterDs));
      if (not) fail('E_UNSUPPORTED_FILTER_PATH', `metric ${not.ref} does not reach ${dsName(filterDs)}, the dataset of the filter`);
    }
    const byHome = new Map();
    for (const e of mets) for (const p of e.parts) {
      if (!byHome.has(p.home)) byHome.set(p.home, []);
      if (!byHome.get(p.home).some(q => q.measure === p.measure)) byHome.get(p.home).push(p);
    }
    branches = [...byHome].map(([home, parts]) => ({ home, parts }));
  } else {
    const sets = [...new Set(dims.map(d => d.r.ds))];
    const anchors = sets.filter(a => sets.every(b => reaches(a, b)));
    if (!anchors.length) fail('E_NO_ANCHOR', `none of the datasets ${sets.map(dsName).join(', ')} reaches the others`);
    if (filterDs && anchors.every(a => !reaches(a, filterDs))) fail('E_UNSUPPORTED_FILTER_PATH', `the anchor ${dsName(anchors[0])} does not reach ${dsName(filterDs)}, the dataset of the filter`);
    if (anchors.length > 1) fail('E_AMBIGUOUS_PATH', `datasets ${anchors.map(dsName).join(', ')} all qualify as the anchor`);
    branches = [{ home: anchors[0], parts: [] }];
  }
  const targets = [...new Set([...dims.map(d => d.r.ds), ...(filterDs ? [filterDs] : [])])];
  for (const b of branches) for (const t of targets) {
    const k = paths(model, b.home, t).length;
    if (k > 1) fail('E_AMBIGUOUS_PATH', `${k} paths lead from ${dsName(b.home)} to ${dsName(t)}`);
  }

  // The lowering (Sections 5.4-5.6).
  const M = sqlName(doc.name);
  const col = (d, f) => `${sqlName(dsName(d))}.${sqlName(f)}`;
  const dimSql = d => col(d.r.ds, d.r.name);
  const from = home => {
    const joined = new Set([home]), joins = [];
    for (const t of targets) for (const s of paths(model, home, t)[0]) {
      if (joined.has(s.to)) continue;
      joined.add(s.to);
      joins.push(`LEFT JOIN ${M}.${sqlName(dsName(s.to))}\n  ON ${s.on.map(([a, b]) => `${col(s.from, a)} = ${col(s.to, b)}`).join(' AND ')}`);
    }
    return [`FROM ${M}.${sqlName(dsName(home))}`, ...joins].join('\n');
  };
  const where = filter != null ? `\nWHERE\n  ${filter}` : '';
  const groupBy = dims.length ? `\nGROUP BY\n  ${dims.map(dimSql).join(',\n  ')}` : '';
  const agg = p => `AGG(${sqlName(dsName(p.home))}.${sqlName(p.measure)})`;
  // A metric's value from its components' values (`val`: a component -> its SQL).
  const metricSql = (e, val) => (e.r.ds != null ? val(e.parts[0])
    : splice(e.text, e.parts.map(p => ({ from: p.from, to: p.to, by: val(p) }))));

  let sql;
  if (branches.length === 1) {
    const b = branches[0];
    const items = [...dims.map(d => `${dimSql(d)} AS ${sqlName(d.out)}`), ...mets.map(e => `${metricSql(e, agg)} AS ${sqlName(e.out)}`)];
    sql = `SELECT\n  ${items.join(',\n  ')}\n${from(b.home)}${where}${groupBy}`;
  } else {
    const used = new Set();
    for (const b of branches) {
      let name = `b_${dsName(b.home).replace(/[^A-Za-z0-9_]/g, '_')}`;
      while (used.has(lc(name))) name += '_';
      used.add(lc(name));
      b.name = name;
      b.cols = new Map(b.parts.map((p, i) => [p.measure, `c${i + 1}`]));
    }
    const ctes = branches.map(b => {
      const items = [...dims.map(d => `${dimSql(d)} AS ${sqlName(d.out)}`), ...b.parts.map(p => `${agg(p)} AS ${b.cols.get(p.measure)}`), ...(dims.length ? ['1 AS present'] : [])];
      return `${b.name} AS (\nSELECT\n  ${items.join(',\n  ')}\n${from(b.home)}${where}${groupBy}\n)`;
    });
    const branchOf = p => branches.find(b => b.home === p.home);
    const val = p => {
      const b = branchOf(p), v = `${b.name}.${b.cols.get(p.measure)}`;
      return dims.length && p.empty != null ? `CASE WHEN ${b.name}.present IS NULL THEN ${p.empty} ELSE ${v} END` : v;
    };
    const items = [...dims.map(d => `keys.${sqlName(d.out)}`), ...mets.map(e => `${metricSql(e, val)} AS ${sqlName(e.out)}`)];
    if (dims.length) {
      const keyCols = dims.map(d => sqlName(d.out));
      ctes.push(`keys AS (\n${branches.map(b => `SELECT ${keyCols.join(', ')} FROM ${b.name}`).join('\nUNION\n')}\n)`);
      const joins = branches.map(b => `LEFT JOIN ${b.name}\n  ON ${keyCols.map(k => `${b.name}.${k} IS NOT DISTINCT FROM keys.${k}`).join(' AND ')}`);
      sql = `WITH ${ctes.join(', ')}\nSELECT\n  ${items.join(',\n  ')}\nFROM keys\n${joins.join('\n')}`;
    } else {
      sql = `WITH ${ctes.join(', ')}\nSELECT\n  ${items.join(',\n  ')}\nFROM ${branches.map(b => b.name).join('\nCROSS JOIN ')}`;
    }
  }

  // The model, with the measures the lowering adds to their home datasets.
  let out = doc;
  if (added.size) {
    out = structuredClone(doc);
    for (const d of out.datasets) {
      const more = added.get(lc(d.name));
      if (more) d.metrics = [...(d.metrics ?? []), ...more.map(m => ({ name: m.name, expression: { sql: m.sql } }))];
    }
  }
  return { sql, doc: out };
}

// The Layer 3 query a SQL query over the model stands for ({ query }), or why it has none
// ({ why }): one SELECT of the model's columns and AGG(measure)s, its WHERE on one dataset,
// GROUP BY ALL (or its columns), and the query valid as Section 8 has it.
const NO_CLAUSES = 'Layer 3 has no ORDER BY, HAVING, ROLLUP or FETCH.';
export function sqlToWide(doc, sql) {
  const model = index(doc);
  let q;
  try { q = parseSql(sql); } catch (e) { return { why: `the SQL does not parse: ${e.message.split('\n')[0]}` }; }
  if (q.with?.length || q.from?.kind !== 'name') return { why: 'Layer 3 is one query over the model: no WITH, no subquery, no join.' };
  const rolled = Array.isArray(q.groupBy) && q.groupBy.some(g => g.k === 'call' && /^(ROLLUP|CUBE|GROUPING SETS)$/i.test(g.fn));
  if (q.orderBy?.length || q.orderAll || q.having || rolled || q.limit != null || q.offset != null || q.ties != null) return { why: NO_CLAUSES };
  const dimensions = [], metrics = [];
  const dataset = name => model.datasets.get(lc(name))?.name ?? name;
  for (const { e, alias } of q.select) {
    if (e.k === 'name' && e.parts.length === 2) {
      const d = model.datasets.get(lc(e.parts[0])), f = d?.fields.get(lc(e.parts[1]));
      const field = `${dataset(e.parts[0])}.${f?.name ?? e.parts[1]}`;
      dimensions.push(alias && lc(alias) !== lc(e.parts[1]) ? { field, alias } : field);
    } else if (e.k === 'call' && String(e.fn).toUpperCase() === 'AGG' && e.args.length === 1 && e.args[0].k === 'name') {
      const p = e.args[0].parts, name = p[p.length - 1];
      let metric;
      if (p.length === 2) metric = `${dataset(p[0])}.${name}`;
      else {
        const d = [...model.datasets.values()].find(x => x.metrics.has(lc(name)));
        metric = d ? `${d.name}.${d.metrics.get(lc(name)).name}` : (model.metrics.get(lc(name))?.name ?? name);
      }
      metrics.push(alias && lc(alias) !== lc(name) ? { metric, alias } : metric);
    } else return { why: 'Layer 3 takes columns and AGG(measure)s, not expressions over them.' };
  }
  const query = { ...(dimensions.length ? { dimensions } : {}), ...(metrics.length ? { metrics } : {}) };
  if (q.where) {
    const sets = [];
    walk(q.where, n => { if (n.k === 'name' && n.parts.length === 2 && !sets.includes(lc(n.parts[0]))) sets.push(lc(n.parts[0])); });
    if (sets.length > 1) {
      const n = sets.length === 2 ? 'two' : String(sets.length);
      return { why: `its WHERE reads ${n} datasets (${sets.map(dataset).join(', ')}); Layer 3 takes a filter on one.` };
    }
    query.filter = q.where.src;
  }
  try { wideToSql(doc, query); } catch (e) { return { why: e.message.split('\n')[0] }; }
  return { query };
}

export function compileWide(doc, query, options = {}) {
  const { sql: layer2, doc: model } = wideToSql(doc, query);
  const compiler = createCompiler(ossieToModel(model), options);
  return { sql: compiler.compileStatement(layer2, model.name).sql, layer2 };
}
