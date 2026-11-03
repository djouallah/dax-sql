// An Apache Ossie semantic model (https://github.com/apache/ossie, core-spec 0.2.0.dev0) and
// TMSL, either way, and as dax-sql's model object. Not part of the package: a reader of one
// format. It takes and gives parsed objects; parsing YAML is the caller's.
//   tmslToOssie(bim)    a model.bim as Ossie
//   ossieToTmsl(doc)    the model.bim an Ossie document stands for
//   ossieToModel(doc)   dax-sql's model object (createCompiler takes it)
// Tables are datasets, columns fields (`sql`: the source column), key columns the primary key,
// relationships relationships, measures the metrics of their table's dataset. A measure or a
// calculated column is in Ossie's portable SQL when it says the same there (ossie-sql.js), and
// in the DAX dialect when not.
//
// The POWER_BI custom extension holds only what Ossie has no place for and something needs: what
// changes an answer (a relationship's filter direction, an inactive relationship, a date table,
// a calculation group, a calculated table's DAX, roles, a column that holds no blank), what
// finds the data (the Direct Lake expression), and what a model's user sees (hidden, format
// strings, display folders, hierarchies, sort-by columns). Lineage tags, annotations,
// summarizeBy and the like go: ossieToTmsl(tmslToOssie(bim)) answers as the bim does, it is not
// the bim. Files written with every TMSL property in the extension read as they always did.
//
// A dataset's `source` is schema.table, its partition's, unless the caller names its table in
// full (tmslToOssie's `source`, a catalog's name such as lakehouse.schema.table): then
// that name says where the data is, and the partition and the expression it read are not kept.
// Back, such a source is the partition's schema (all of it but the table) and entity.
import { tmslToModel } from './tmsl.js';
import { measureSql, columnSql, parseDax, metricDax, fieldDax, sourceColumnOf, sqlName } from './ossie-sql.js';

const VERSION = '0.2.0.dev0';
const VENDOR = 'POWER_BI';
// A measure that was one of the model's own metrics (the root's, not a dataset's): back, it is
// one again.
const MODEL_METRIC = { name: 'OssieScope', value: 'model' };
const modelMetric = ms => (ms.annotations ?? []).some(a => a.name === MODEL_METRIC.name && a.value === MODEL_METRIC.value);
const text = e => (Array.isArray(e) ? e.join('\n') : e);
const lc = s => String(s).toLowerCase();
const TO_OSSIE = { string: 'String', int64: 'Integer', decimal: 'Decimal', double: 'Float', boolean: 'Boolean' };
const TO_TMSL = { String: 'string', Integer: 'int64', Decimal: 'decimal', Float: 'double', Boolean: 'boolean', Date: 'dateTime', DateTime: 'dateTime', DateTimeTz: 'dateTime' };
// A dateTime column whose format has no time of day is a date.
const datatype = c => (c.dataType === 'dateTime' ? (/[Hhms]/.test(c.formatString ?? 'H') ? 'DateTime' : 'Date') : TO_OSSIE[c.dataType]);

const ext = data => (Object.keys(data).length ? { custom_extensions: [{ vendor_name: VENDOR, data: JSON.stringify(data) }] } : {});
function powerBi(o) {
  const e = (o.custom_extensions ?? []).find(x => String(x.vendor_name).toUpperCase() === VENDOR);
  return e ? JSON.parse(e.data) : {};
}
const optional = (k, v) => (v == null ? {} : { [k]: v });
// The properties of `o` named in `keep` that `when` takes (by default: any value).
const pick = (o, keep, when = v => v != null) => Object.fromEntries(keep.filter(k => when(o[k], k)).map(k => [k, o[k]]));
// Bookkeeping Power BI writes at every level, which no answer and no view depends on.
const NOISE = new Set(['lineageTag', 'sourceLineageTag', 'annotations', 'changedProperties', 'modifiedTime', 'structureModifiedTime', 'refreshedTime']);
const clean = v => (Array.isArray(v) ? v.map(clean)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !NOISE.has(k)).map(([k, x]) => [k, clean(x)])) : v);

const isData = c => !c.type || c.type === 'data';
const entity = t => {
  const p = t.partitions ?? [];
  const s = p[0]?.source;
  return p.length === 1 && (s?.type === 'entity' || (s?.type == null && s?.entityName)) ? p[0] : null;
};
const partitionDefault = p => ({ ...optional('mode', p.mode), ...optional('expressionSource', p.source.expressionSource) });

function field(c, table) {
  const left = pick(c, ['isHidden'], v => v === true);
  Object.assign(left, pick(c, ['formatString', 'displayFolder', 'sortByColumn']));
  if (c.isAvailableInMdx === false) left.isAvailableInMdx = false;
  if (c.isNullable === false) left.isNullable = false;
  const params = (c.extendedProperties ?? []).filter(p => p.name === 'ParameterMetadata');
  if (params.length) left.extendedProperties = clean(params);
  const type = datatype(c);
  if (c.dataType != null && TO_TMSL[type] !== c.dataType) left.dataType = c.dataType;
  let expression;
  if (c.type === 'calculated') {
    const code = text(c.expression);
    const sql = columnSql(parseDax(code), table);
    expression = sql != null ? { sql } : { dialects: [{ dialect: 'DAX', expression: code }] };
  } else {
    if (!isData(c)) left.type = c.type;
    expression = { sql: sqlName(c.sourceColumn ?? c.name) };
  }
  return {
    name: c.name,
    expression,
    ...optional('datatype', type),
    ...optional('description', text(c.description)),
    ...ext(left),
  };
}

function metric(ms, home, sql, modelScoped = false) {
  const left = pick(ms, ['formatString', 'formatStringDefinition', 'displayFolder']);
  if (ms.isHidden === true) left.isHidden = true;
  // A measure kept on a table other than the one it reads, or on no dataset.
  if (modelScoped || (sql && lc(sql.table) !== lc(home))) left.table = home;
  return {
    name: ms.name,
    expression: sql ? { sql: sql.sql } : { dialects: [{ dialect: 'DAX', expression: text(ms.expression) ?? '' }] },
    ...optional('description', text(ms.description)),
    ...(sql && TO_TMSL[sql.type] ? { datatype: sql.type } : {}),
    ...ext(left),
  };
}

export function tmslToOssie(bim, name = 'model', { source = () => null } = {}) {
  const m = bim.model;
  // A table the caller names in full, by its single entity partition: name -> its name.
  const named = new Map(m.tables.map(t => [t, entity(t) ? source(t) ?? null : null]).filter(([, n]) => n));
  // What the translator knows of each table, and every measure (a measure it inlines).
  const tables = new Map(m.tables.map(t => [lc(t.name), {
    name: t.name,
    columns: new Map((t.columns ?? []).filter(c => c.type !== 'rowNumber').map(c => [lc(c.name),
      { name: c.name, type: datatype(c), source: isData(c) ? (c.sourceColumn ?? c.name) : null }])),
  }]));
  const measures = new Map(m.tables.flatMap(t => (t.measures ?? []).map(ms => [lc(ms.name), { ast: parseDax(text(ms.expression) ?? '') }])));

  // The partition most tables have, which a dataset with none of its own reads back as.
  const counts = new Map();
  for (const t of m.tables) {
    const p = !named.has(t) && entity(t);
    if (p) { const k = JSON.stringify(partitionDefault(p)); counts.set(k, (counts.get(k) ?? 0) + 1); }
  }
  const defaultKey = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '{}';
  const defaults = JSON.parse(defaultKey);
  const ENTITY_KEYS = ['type', 'entityName', 'schemaName', 'expressionSource'];
  const rebuilt = t => {
    const p = entity(t);
    return p && JSON.stringify(partitionDefault(p)) === defaultKey && Object.keys(p.source).every(k => ENTITY_KEYS.includes(k));
  };

  // Each measure on the dataset it reads when it is SQL, on its own table's when it is DAX. A
  // dataset's fields and metrics share its names: a measure named like a column of the dataset
  // it would be on is the model's, in DAX, with its table in the extension.
  const metricsOf = new Map(m.tables.map(t => [lc(t.name), []]));
  const modelMetrics = [];
  for (const t of m.tables) {
    for (const ms of t.measures ?? []) {
      const ast = measures.get(lc(ms.name)).ast;
      let sql = ast && measureSql(ast, tables, measures);
      if (modelMetric(ms)) { modelMetrics.push(metric(ms, t.name, sql, !sql)); continue; }
      if (sql && tables.get(lc(sql.table)).columns.has(lc(ms.name))) sql = null;
      if (sql || !tables.get(lc(t.name)).columns.has(lc(ms.name))) metricsOf.get(lc(sql ? sql.table : t.name)).push(metric(ms, t.name, sql));
      else modelMetrics.push(metric(ms, t.name, null, true));
    }
  }

  const expressionsUsed = new Set();
  if (defaults.expressionSource) expressionsUsed.add(defaults.expressionSource);
  const datasets = m.tables.map(t => {
    const s = t.partitions?.[0]?.source;
    const keys = (t.columns ?? []).filter(c => c.isKey === true).map(c => c.name);
    const left = {};
    if (t.isHidden === true) left.isHidden = true;
    if (t.dataCategory === 'Time') left.dataCategory = 'Time';
    if (t.calculationGroup) left.calculationGroup = clean(t.calculationGroup);
    if (t.hierarchies?.length) left.hierarchies = clean(t.hierarchies);
    if (t.partitions && !named.has(t) && !rebuilt(t)) {
      left.partitions = clean(t.partitions);
      for (const p of t.partitions) if (p.source?.expressionSource) expressionsUsed.add(p.source.expressionSource);
    }
    const metrics = metricsOf.get(lc(t.name));
    return {
      name: t.name,
      source: named.get(t) ?? (s?.entityName ? (s.schemaName ? `${s.schemaName}.${s.entityName}` : s.entityName) : t.name),
      ...(keys.length ? { primary_key: keys } : {}),
      ...optional('description', text(t.description)),
      fields: (t.columns ?? []).filter(c => c.type !== 'rowNumber').map(c => field(c, tables.get(lc(t.name)))),
      ...(metrics.length ? { metrics } : {}),
      ...ext(left),
    };
  });

  const relationships = m.relationships?.map((r, i) => {
    const left = {};
    if (r.isActive === false) left.isActive = false;
    if (r.crossFilteringBehavior === 'bothDirections') left.crossFilteringBehavior = r.crossFilteringBehavior;
    if (r.fromCardinality != null && r.fromCardinality !== 'many') left.fromCardinality = r.fromCardinality;
    if (r.toCardinality != null && r.toCardinality !== 'one') left.toCardinality = r.toCardinality;
    if (r.relyOnReferentialIntegrity === true) left.relyOnReferentialIntegrity = true;
    if (r.securityFilteringBehavior != null && r.securityFilteringBehavior !== 'oneDirection') left.securityFilteringBehavior = r.securityFilteringBehavior;
    if (r.joinOnDateBehavior != null) left.joinOnDateBehavior = r.joinOnDateBehavior;
    return { name: r.name ?? `rel${i}`, from: r.fromTable, to: r.toTable, from_columns: [r.fromColumn], to_columns: [r.toColumn], ...ext(left) };
  });

  // The model's own: how its tables are stored and where (the Direct Lake expression a
  // partition names), and its roles, without their members.
  const model = {};
  // A storage mode is a partition's: with every table named in full, none is kept.
  if (m.defaultMode && m.tables.some(t => t.partitions && !named.has(t))) model.defaultMode = m.defaultMode;
  const expressions = (m.expressions ?? []).filter(e => expressionsUsed.has(e.name));
  if (expressions.length) model.expressions = clean(expressions).map(e => pick(e, ['name', 'kind', 'expression']));
  const roles = (m.roles ?? []).map(r => ({
    name: r.name,
    ...(r.modelPermission && r.modelPermission !== 'read' ? { modelPermission: r.modelPermission } : {}),
    ...(r.tablePermissions?.length ? { tablePermissions: r.tablePermissions.map(p => pick(p, ['name', 'filterExpression'])) } : {}),
  }));
  if (roles.length) model.roles = roles;
  return {
    version: VERSION,
    name: bim.name ?? name,
    ...optional('description', text(m.description)),
    datasets,
    ...(relationships ? { relationships } : {}),
    ...(modelMetrics.length ? { metrics: modelMetrics } : {}),
    ...ext({ ...(Object.keys(model).length ? { model } : {}), ...(Object.keys(defaults).length ? { partition: defaults } : {}) }),
  };
}

const dax = o => o.expression?.dialects?.find(d => d.dialect === 'DAX')?.expression;
// A field's or a metric's SQL: the portable `sql`, or a SQL dialect (files of earlier drafts
// wrote ANSI_SQL).
const sqlOf = o => o.expression?.sql
  ?? o.expression?.dialects?.find(d => d.dialect === 'OSSIE_SQL_2026' || d.dialect === 'ANSI_SQL')?.expression;
// Back: what the core says, and the extension over it; a property it holds as null is one
// the TMSL did not have.
const tmsl = (core, extra) => Object.fromEntries(Object.entries({ ...core, ...extra }).filter(([, v]) => v !== null && v !== undefined));
// The last dot of a dotted name that is not inside "quotes", or -1.
function lastDot(name) {
  let at = -1, q = false;
  for (let i = 0; i < name.length; i++) {
    if (name[i] === '"') q = !q;
    else if (name[i] === '.' && !q) at = i;
  }
  return at;
}
const measureDax = (m, dataset, datasets) => {
  const code = dax(m);
  if (code != null) return { dax: code, table: null };
  const sql = sqlOf(m);
  if (sql == null) throw new Error(`metric '${m.name}' has no DAX expression and no SQL`);
  try { return metricDax(sql, dataset, datasets); }
  catch (e) { throw new Error(`metric '${m.name}' has no DAX expression, and its SQL is beyond what dax-sql reads: ${e.message}`); }
};

export function ossieToTmsl(doc) {
  // `partition`: the one a dataset with none of its own has. The rest is the TMSL's.
  const { model: modelExtra = {}, partition: defaults = {}, ...docExtra } = powerBi(doc);
  const tables = doc.datasets.map(d => {
    const keys = new Set(d.primary_key ?? []);
    const extra = powerBi(d);
    const dot = lastDot(d.source);
    const [schema, entityName] = dot < 0 ? [null, d.source] : [d.source.slice(0, dot), d.source.slice(dot + 1)];
    // A source named in full says where it is: the model's partition is for schema.table.
    const own = dot < 0 || lastDot(schema) < 0 ? defaults : {};
    // A field is a source column when its SQL is one (a file of an earlier draft wrote it as
    // it was, in ANSI_SQL), and a calculated column when its SQL is more.
    const fields = (d.fields ?? []).map(f => {
      const e = powerBi(f), code = dax(f), sql = sqlOf(f);
      const source = code != null ? null : f.expression?.sql != null ? sourceColumnOf(sql) : sql;
      return { f, e, code, sql, source };
    });
    const dataColumns = fields.filter(x => x.source != null && !x.e.type).map(x => ({ name: x.f.name, source: x.source }));
    const columns = fields.map(({ f, e, code, sql, source }) => {
      let def;
      if (code != null) def = { type: 'calculated', expression: code };
      else if (source != null || e.type) def = { sourceColumn: source ?? sql };
      else {
        try { def = { type: 'calculated', expression: fieldDax(sql, d.name, dataColumns) }; }
        catch (err) { throw new Error(`field '${d.name}.${f.name}': its SQL is beyond what dax-sql reads: ${err.message}`); }
      }
      return tmsl({
        name: f.name,
        description: f.description,
        dataType: TO_TMSL[f.datatype],
        ...def,
        ...(keys.has(f.name) ? { isKey: true } : {}),
      }, e);
    });
    const partition = { name: d.name, ...(own.mode ? { mode: own.mode } : {}),
      source: tmsl({ type: 'entity', entityName, schemaName: schema, expressionSource: own.expressionSource }, {}) };
    return tmsl({
      name: d.name,
      description: d.description,
      columns,
      ...(extra.partitions ? {} : { partitions: [partition] }),
    }, extra);
  });
  const byName = new Map(tables.map(t => [t.name.toLowerCase(), t]));
  const place = (m, table, code, model = false) => {
    const home = table == null ? tables[0] : byName.get(String(table).toLowerCase());
    if (!home) throw new Error(`metric '${m.name}': the model has no table '${table}'`);
    const { table: _, ...extra } = powerBi(m);
    if (model) extra.annotations = [...(extra.annotations ?? []), MODEL_METRIC];
    (home.measures ??= []).push(tmsl({ name: m.name, description: m.description, expression: code }, extra));
  };
  for (const d of doc.datasets) {
    for (const m of d.metrics ?? []) {
      const { dax: code } = measureDax(m, d, doc.datasets);
      place(m, powerBi(m).table ?? d.name, code);
    }
  }
  for (const m of doc.metrics ?? []) {
    const { dax: code, table } = measureDax(m, null, doc.datasets);
    place(m, powerBi(m).table ?? table, code, true);
  }
  const relationships = doc.relationships?.map(r => {
    if (r.from_columns.length !== 1 || r.to_columns.length !== 1) throw new Error(`relationship '${r.name}': TMSL joins one column`);
    return tmsl({ name: r.name, fromTable: r.from, fromColumn: r.from_columns[0], toTable: r.to, toColumn: r.to_columns[0] }, powerBi(r));
  });
  return tmsl({
    name: doc.name,
    ...docExtra,
    model: tmsl({ description: doc.description, tables, relationships }, modelExtra),
  }, {});
}

export const ossieToModel = doc => tmslToModel(ossieToTmsl(doc));
