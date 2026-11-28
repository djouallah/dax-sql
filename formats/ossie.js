// An Apache Ossie semantic model (https://github.com/apache/ossie, core-spec 0.3.0.dev0) and
// TMSL, either way, and as dax-sql's model object. Not part of the package: a reader of one
// format. It takes and gives parsed objects; parsing YAML is the caller's.
//   tmslToOssie(bim)    a model.bim as Ossie
//   ossieToTmsl(doc, { onSkip })   the model.bim an Ossie document stands for; doc may be a folder
//                                  of them, { 'path.yaml': doc }, merged as Fabric merges (ossieFolder)
//   ossieToModel(doc, { onSkip })  dax-sql's model object (createCompiler takes it)
// A metric or a field it cannot say in DAX (one in another engine's dialect alone, or SQL beyond
// what dax-sql reads) is left out, not the model refused: onSkip({ kind, name, dataset, why }) hears of each.
// Tables are datasets, columns fields (`sql`: the source column), key columns the primary key,
// relationships relationships, measures the metrics of their table's dataset. A measure or a
// calculated column is in Ossie's portable SQL when it says the same there (ossie-sql.js), and
// in the DAX dialect when not.
//
// The POWER_BI extension (`nonportable_extensions`, its `data` an object) holds only what Ossie has no place for and something needs: what
// changes an answer (a relationship's filter direction, an inactive relationship, a date table,
// a calculation group, a calculated table's DAX, roles, a column that holds no blank), what
// finds the data (the Direct Lake expression), and what a model's user sees (hidden, format
// strings, display folders, hierarchies, sort-by columns). Lineage tags, annotations,
// summarizeBy and the like go: ossieToTmsl(tmslToOssie(bim)) answers as the bim does, it is not
// the bim. Files written with every TMSL property in the extension read as they always did, and
// so do files of the spec before (`custom_extensions`, its `data` a JSON string).
//
// A dataset's `source` is schema.table, its partition's, unless the caller names its table in
// full (tmslToOssie's `source`, a catalog's name such as lakehouse.schema.table): then
// that name says where the data is, and the partition and the expression it read are not kept.
// Back, such a source is the partition's schema (all of it but the table) and entity.
import { tmslToModel } from './tmsl.js';
import { DaxError } from '../src/errors.js';
import { measureSql, columnSql, parseDax, metricDax, fieldDax, sourceColumnOf, dialectSourceOf, sqlName } from './ossie-sql.js';

const VERSION = '0.3.0.dev0';
const VENDOR = 'POWER_BI';
// What Ossie wrote, kept in an `Ossie` annotation so that it comes back as it was written. A
// measure: where it was (its dataset, or null for the model's own; `home`, the table it was put
// on) and, when it was SQL, its expression as written, its datatype and the DAX it was read as.
// A column whose expression tmslToOssie would not write the same: that expression and what it
// was read as (`as`). `placed`: a model's own metric in SQL whose table the extension named.
// While the TMSL is still what was read, the expression is the one written,
// in its dialect, word for word: COUNT stays COUNT, a CASE a CASE, ANSI_SQL ANSI_SQL. Changed
// since (in Power BI, say), it is translated.
const OSSIE = 'Ossie';
// A table's key of several columns (Power BI's isKey is of one), as a JSON list of their names.
export const PRIMARY_KEY = 'PrimaryKey';
function fromOssie(ms) {
  const a = (ms.annotations ?? []).find(x => x.name === OSSIE);
  try { return a ? JSON.parse(a.value) : null; } catch { return null; }
}
const text = e => (Array.isArray(e) ? e.join('\n') : e);
const lc = s => String(s).toLowerCase();
const TO_OSSIE = { string: 'String', int64: 'Integer', decimal: 'Decimal', double: 'Float', boolean: 'Boolean' };
const TO_TMSL = { String: 'string', Integer: 'int64', Decimal: 'decimal', Float: 'double', Boolean: 'boolean', Date: 'dateTime', DateTime: 'dateTime', DateTimeTz: 'dateTime' };
// A TMSL dataType as a field's datatype (a source column columnsOf gives).
const FROM_TMSL = { ...TO_OSSIE, dateTime: 'DateTime' };
// A dateTime column whose format has no time of day is a date.
const datatype = c => (c.dataType === 'dateTime' ? (/[Hhms]/.test(c.formatString ?? 'H') ? 'DateTime' : 'Date') : TO_OSSIE[c.dataType]);

// `data` is JSON: a copy, with nothing undefined in it.
const ext = data => (Object.keys(data).length ? { nonportable_extensions: [{ vendor_name: VENDOR, data: JSON.parse(JSON.stringify(data)) }] } : {});
function powerBi(o) {
  const e = (o.nonportable_extensions ?? o.custom_extensions ?? []).find(x => String(x.vendor_name).toUpperCase() === VENDOR);
  if (!e?.data) return {};
  return typeof e.data === 'string' ? JSON.parse(e.data) : JSON.parse(JSON.stringify(e.data));
}
const optional = (k, v) => (v == null ? {} : { [k]: v });
// The properties of `o` named in `keep` that `when` takes (by default: any value).
const pick = (o, keep, when = v => v != null) => Object.fromEntries(keep.filter(k => when(o[k], k)).map(k => [k, o[k]]));
// Bookkeeping Power BI writes at every level, which no answer and no view depends on.
const NOISE = new Set(['lineageTag', 'sourceLineageTag', 'annotations', 'changedProperties', 'modifiedTime', 'structureModifiedTime', 'refreshedTime']);
const clean = v => (Array.isArray(v) ? v.map(clean)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !NOISE.has(k)).map(([k, x]) => [k, clean(x)])) : v);

// A table's key: its column whose isKey is set, or the columns its PrimaryKey annotation names.
const primaryKey = t => {
  const note = (t.annotations ?? []).find(a => a.name === PRIMARY_KEY);
  return note ? JSON.parse(note.value) : (t.columns ?? []).filter(c => c.isKey === true).map(c => c.name);
};

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
  const was = fromOssie(c);
  if (was?.expression && JSON.stringify(was.as) === JSON.stringify(readAs(c))) expression = was.expression;
  return {
    name: c.name,
    expression,
    ...optional('datatype', type),
    ...optional('description', text(c.description)),
    ...ext(left),
  };
}

// What a column was read as: its source column, or its DAX.
const readAs = c => (c.type === 'calculated' ? { expression: text(c.expression) } : { sourceColumn: c.sourceColumn ?? c.name });

function metric(ms, home, sql, modelScoped = false) {
  const left = pick(ms, ['formatString', 'formatStringDefinition', 'displayFolder']);
  if (ms.isHidden === true) left.isHidden = true;
  // A measure kept on a table other than the one it reads, or on no dataset.
  if (modelScoped || (sql && lc(sql.table) !== lc(home))) left.table = home;
  return {
    name: ms.name,
    expression: sql ? sql.expression ?? { sql: sql.sql } : { dialects: [{ dialect: 'DAX', expression: text(ms.expression) ?? '' }] },
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
  // it would be on is the model's, in DAX, with its table in the extension. A measure that is
  // not SQL on one dataset, and is made of measures that are (a ratio of two tables' measures):
  // the model's, in SQL, each of them as AGG(dataset.metric).
  const metricsOf = new Map(m.tables.map(t => [lc(t.name), []]));
  const modelMetrics = [];
  // The measures that are a dataset's metric in SQL, which AGG evaluates: name -> where.
  const sqlMetrics = new Map();
  const isSql = (ms, dataset, type) => sqlMetrics.set(lc(ms.name), { dataset: tables.get(lc(dataset)).name, name: ms.name, type });
  const inDax = [];
  for (const t of m.tables) {
    for (const ms of t.measures ?? []) {
      const ast = measures.get(lc(ms.name)).ast;
      let sql = ast && measureSql(ast, tables, measures);
      const was = fromOssie(ms);
      if (was && (was.dataset == null || tables.has(lc(was.dataset)))) {
        const kept = was.expression != null && was.dax === text(ms.expression);
        if (kept) sql = { expression: was.expression, table: was.home, type: was.datatype };
        // The model's own, no longer what was read: its SQL here is a dataset's, names unqualified.
        else if (was.dataset == null) sql = null;
        const at = was.dataset == null ? (kept ? was.home : sql?.table) : was.dataset;
        (was.dataset == null ? modelMetrics : metricsOf.get(lc(was.dataset))).push(metric(ms, t.name, sql, lc(at ?? '') !== lc(t.name) || (kept && was.placed === true)));
        if (sql && was.dataset != null) isSql(ms, was.dataset, sql.type);
        continue;
      }
      if (sql && tables.get(lc(sql.table)).columns.has(lc(ms.name))) sql = null;
      if (sql) {
        metricsOf.get(lc(sql.table)).push(metric(ms, t.name, sql));
        isSql(ms, sql.table, sql.type);
        continue;
      }
      const own = !tables.get(lc(t.name)).columns.has(lc(ms.name));
      const list = own ? metricsOf.get(lc(t.name)) : modelMetrics;
      const written = metric(ms, t.name, null, !own);
      list.push(written);
      if (ast) inDax.push({ ms, home: t.name, ast, list, written });
    }
  }
  for (const { ms, home, ast, list, written } of inDax) {
    const sql = measureSql(ast, tables, measures, name => sqlMetrics.get(lc(name)));
    if (!sql) continue;
    const now = metric(ms, home, sql, true);
    if (list === modelMetrics) list[list.indexOf(written)] = now;
    else { list.splice(list.indexOf(written), 1); modelMetrics.push(now); }
  }
  // The model's metrics in the order of their measures, whichever way each got there.
  const order = new Map(m.tables.flatMap(t => t.measures ?? []).map((ms, i) => [ms.name, i]));
  modelMetrics.sort((a, b) => order.get(a.name) - order.get(b.name));

  const expressionsUsed = new Set();
  if (defaults.expressionSource) expressionsUsed.add(defaults.expressionSource);
  const datasets = m.tables.map(t => {
    const s = t.partitions?.[0]?.source;
    const keys = primaryKey(t);
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
    ...(r.tablePermissions?.length ? { tablePermissions: r.tablePermissions.map(p => pick(p, ['name', 'filterExpression', 'metadataPermission', 'columnPermissions'])) } : {}),
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
  if (sql == null) return { skip: `metric '${m.name}' has no DAX expression and no SQL` };
  try { return metricDax(sql, dataset, datasets); }
  catch (e) { return { skip: `metric '${m.name}' has no DAX expression, and its SQL is beyond what dax-sql reads: ${e.message}` }; }
};

// What a Fabric semantic view leaves to the platform, given by the host (it reads the data and
// knows where the view is):
//   catalog    a source named schema.table alone (or table), with no Direct Lake expression to
//              read it by, is read in this catalog, the lakehouse that holds the view: its schema
//              becomes "catalog"."schema" (dbo when it names none);
//   columnsOf  a dataset with no fields has every column of its source, as
//              columnsOf({ dataset, source }) says: [{ name, type }], the engine's type names
//              (BIGINT, DECIMAL(18,2), TIMESTAMP WITH TIME ZONE…), those a model cannot hold
//              (struct, list, map, binary) left out and said to onSkip; null when not known. With
//              none, the table has its key and relationship columns, as text, so the model holds.
// It is called as the document is read: the host reads the columns first (ossieSources lists
// what it will be asked).
export function ossieToTmsl(doc, { onSkip = () => {}, catalog = null, columnsOf = null } = {}) {
  if (isFolder(doc)) doc = ossieFolder(doc);
  if (catalog != null && typeof catalog !== 'string') throw new DaxError('ossieToTmsl: catalog is a text', { code: 'INPUT' });
  if (columnsOf != null && typeof columnsOf !== 'function') throw new DaxError('ossieToTmsl: columnsOf is a function ({ dataset, source }) => [{ name, type }]', { code: 'INPUT' });
  // `partition`: the one a dataset with none of its own has. The rest is the TMSL's.
  const { model: modelExtra = {}, partition: defaults = {}, ...docExtra } = powerBi(doc);
  // A dataset with no fields has its source's (columnsOf): for its table and for its metrics alike.
  const datasets = doc.datasets.map(d => (d.fields?.length ? d : { ...d, fields: sourceFields(d, doc, columnsOf, onSkip) }));
  const tables = datasets.map(d => {
    const keys = new Set(d.primary_key ?? []);
    const extra = powerBi(d);
    const dot = lastDot(d.source);
    let [schema, entityName] = dot < 0 ? [null, d.source] : [d.source.slice(0, dot), d.source.slice(dot + 1)];
    // A source named in full says where it is: the model's partition is for schema.table.
    const own = dot < 0 || lastDot(schema) < 0 ? defaults : {};
    if (catalog != null && !own.expressionSource && (dot < 0 || lastDot(schema) < 0)) {
      schema = `${quoteName(catalog)}.${schema?.startsWith('"') ? schema : quoteName(schema ?? 'dbo')}`;
    }
    // A field is a source column when its SQL is one (a file of an earlier draft wrote it as
    // it was, in ANSI_SQL, quoted or not), and a calculated column when its SQL is more.
    const fields = (d.fields ?? []).map(f => {
      const e = powerBi(f), code = dax(f), sql = sqlOf(f);
      const source = code != null ? null : f.expression?.sql != null ? sourceColumnOf(sql) : dialectSourceOf(sql);
      return { f, e, code, sql, source };
    });
    const dataColumns = fields.filter(x => x.source != null && !x.e.type).map(x => ({ name: x.f.name, source: x.source }));
    const columns = fields.flatMap(({ f, e, code, sql, source }) => {
      let def;
      if (code != null) def = { type: 'calculated', expression: code };
      else if (source != null || e.type) def = { sourceColumn: source ?? sql };
      else {
        try { def = { type: 'calculated', expression: fieldDax(sql, d.name, dataColumns) }; }
        catch (err) {
          onSkip({ kind: 'field', name: f.name, dataset: d.name, why: `field '${d.name}.${f.name}': its SQL is beyond what dax-sql reads: ${err.message}` });
          return [];
        }
      }
      // An expression tmslToOssie writes the same needs nothing kept: a source column's `sql`,
      // or DAX alone.
      const same = def.sourceColumn != null && !e.type ? f.expression?.sql === sqlName(def.sourceColumn) && !f.expression.dialects
        : code != null && Object.keys(f.expression).length === 1 && f.expression.dialects.length === 1;
      const col = tmsl({ name: f.name, description: f.description, dataType: TO_TMSL[f.datatype], ...def }, {});
      return [tmsl({
        ...col,
        // A key of one column is the column's isKey; Power BI has no key of several (a table's
        // annotation PrimaryKey says it, for dax-sql and the way back).
        ...(keys.size === 1 && keys.has(f.name) ? { isKey: true } : {}),
        ...(same ? {} : { annotations: [{ name: OSSIE, value: JSON.stringify({ expression: f.expression, as: readAs(col) }) }] }),
      }, e)];
    });
    const partition = { name: d.name, ...(own.mode ? { mode: own.mode } : {}),
      source: tmsl({ type: 'entity', entityName, schemaName: schema, expressionSource: own.expressionSource }, {}) };
    const keyNote = keys.size > 1 ? [{ name: PRIMARY_KEY, value: JSON.stringify([...keys]) }] : [];
    return tmsl({
      name: d.name,
      description: d.description,
      columns,
      ...(extra.partitions ? {} : { partitions: [partition] }),
      ...(keyNote.length ? { annotations: [...(extra.annotations ?? []), ...keyNote] } : {}),
    }, keyNote.length ? Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'annotations')) : extra);
  });
  const byName = new Map(tables.map(t => [t.name.toLowerCase(), t]));
  const place = (m, table, code, dataset) => {
    const home = table == null ? tables[0] : byName.get(String(table).toLowerCase());
    if (!home) throw new Error(`metric '${m.name}': the model has no table '${table}'`);
    const { table: named, ...extra } = powerBi(m);
    // Its SQL, kept to write back: alone, it was read as DAX; beside a DAX, the DAX is read.
    const sql = sqlOf(m);
    const was = { dataset, home: home.name, ...(sql != null ? { expression: m.expression, dax: code, ...optional('datatype', m.datatype) } : {}),
      ...(sql != null && dataset == null && named != null ? { placed: true } : {}) };
    extra.annotations = [...(extra.annotations ?? []).filter(a => a.name !== OSSIE), { name: OSSIE, value: JSON.stringify(was) }];
    (home.measures ??= []).push(tmsl({ name: m.name, description: m.description, expression: code }, extra));
  };
  for (const d of datasets) {
    for (const m of d.metrics ?? []) {
      const { dax: code, skip } = measureDax(m, d, datasets);
      if (skip) onSkip({ kind: 'metric', name: m.name, dataset: d.name, why: skip });
      else place(m, powerBi(m).table ?? d.name, code, d.name);
    }
  }
  for (const m of doc.metrics ?? []) {
    const { dax: code, table, skip } = measureDax(m, null, datasets);
    if (skip) onSkip({ kind: 'metric', name: m.name, dataset: null, why: skip });
    else place(m, powerBi(m).table ?? table, code, null);
  }
  const relationships = doc.relationships?.map(r => {
    if (r.from_columns.length !== 1 || r.to_columns.length !== 1) throw new Error(`relationship '${r.name}': TMSL joins one column`);
    return tmsl({ name: r.name, fromTable: r.from, fromColumn: r.from_columns[0], toTable: r.to, toColumn: r.to_columns[0] }, powerBi(r));
  });
  // A Power BI model (V3), which Power BI imports from JSON, unless the extension says otherwise.
  return tmsl({
    name: doc.name,
    compatibilityLevel: 1604,
    ...docExtra,
    model: tmsl({ culture: 'en-US', defaultPowerBIDataSourceVersion: 'powerBI_V3', description: doc.description, tables, relationships }, modelExtra),
  }, {});
}

export const ossieToModel = (doc, opts) => tmslToModel(ossieToTmsl(doc, opts));

const quoteName = s => `"${String(s).replace(/"/g, '""')}"`;

// The datasets of a document (or folder) whose columns ossieToTmsl will ask columnsOf: those with
// no fields, [{ dataset, source }], so a host reads their columns first.
export function ossieSources(doc) {
  if (isFolder(doc)) doc = ossieFolder(doc);
  return (doc.datasets ?? []).filter(d => !d.fields?.length).map(d => ({ dataset: d.name, source: d.source }));
}

// An engine's type name as TMSL's dataType, or null for one a model cannot hold.
export function tmslType(type) {
  const t = String(type ?? '').trim().toLowerCase();
  if (/\[\]$/.test(t) || /^(struct|list|map|array|union|row|json|geometry|geography|binary|blob|varbinary|bytea|bytes|bit\s+varying|image|interval)\b/.test(t)) return null;
  if (/^(u?(tiny|small|big|huge)?int(eger)?\d*|long|short|byte|int\d+|u(tiny|small|big|huge)?int)\b/.test(t)) return 'int64';
  if (/^(double|float\d*|real)\b/.test(t)) return 'double';
  if (/^(decimal|numeric|number|money|smallmoney|dec)\b/.test(t)) return 'decimal';
  if (/^(bool|boolean|bit)\b/.test(t)) return 'boolean';
  if (/^(date|time|timestamp|datetime\d*|smalldatetime|datetimeoffset|timestamptz)\b/.test(t)) return 'dateTime';
  if (/^(varchar|char|nvarchar|nchar|text|ntext|string|uuid|guid|uniqueidentifier|enum|bpchar|character|clob)\b/.test(t)) return 'string';
  return null;
}

// A dataset with no fields: its source's columns as columnsOf says (fields of that name and type),
// or else its key and relationship columns as text.
function sourceFields(d, doc, columnsOf, onSkip) {
  const read = columnsOf ? columnsOf({ dataset: d.name, source: d.source }) : null;
  if (Array.isArray(read)) {
    return read.flatMap(c => {
      const type = tmslType(c?.type);
      if (!c?.name || !type) {
        onSkip({ kind: 'field', name: c?.name ?? null, dataset: d.name, why: `field '${d.name}.${c?.name}': a column of type ${c?.type}, which a model cannot hold` });
        return [];
      }
      return [{ name: String(c.name), datatype: FROM_TMSL[type], expression: { sql: sqlName(String(c.name)) } }];
    });
  }
  const names = new Set(d.primary_key ?? []);
  for (const r of doc.relationships ?? []) {
    if (r.from === d.name) (r.from_columns ?? []).forEach(c => names.add(c));
    if (r.to === d.name) (r.to_columns ?? []).forEach(c => names.add(c));
  }
  return [...names].map(n => ({ name: n, datatype: 'String', expression: { sql: sqlName(n) } }));
}

// A folder: an object of files by path, each a .yaml or .yml (a document has its datasets,
// version and name as keys instead).
const isFolder = x => x !== null && typeof x === 'object' && !Array.isArray(x) && !('datasets' in x)
  && Object.keys(x).length > 0 && Object.keys(x).every(k => /\.ya?ml$/i.test(k));

// A Fabric semantic view's folder of Apache Ossie files (Context/Semantic Views/<view>/:
// datasets/dimensions.yaml, relationships.yaml, metrics/all.yaml, model.yaml…) as one document,
// merged as Fabric merges them on publish: only the .yaml files (a .yml beside them is not read,
// as Fabric does not read it); each has its version and name; the lists are concatenated in any
// file order (here by path); a dataset, relationship or metric (a metric by its name in any
// case) is defined once across the files; the description is the same wherever it is given. The
// files are parsed already, as a document is (parsing YAML is the caller's). An error is an
// INPUT one, naming the files.
const LISTS = ['datasets', 'relationships', 'metrics', 'custom_extensions', 'nonportable_extensions'];
export function ossieFolder(files) {
  const bad = msg => new DaxError(`Ossie folder: ${msg}`, { code: 'INPUT' });
  const read = Object.entries(files).filter(([p]) => /\.yaml$/i.test(p)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (!read.length) throw bad('no .yaml file in it');
  const merged = {}, defined = new Map();
  for (const [path, doc] of read) {
    if (typeof doc === 'string') throw bad(`${path} is text: parse its YAML first (the reader takes parsed documents)`);
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw bad(`${path} is not an Ossie document`);
    for (const key of ['version', 'name']) if (doc[key] == null) throw bad(`${path} has no ${key}`);
    if (doc.description != null) {
      if (merged.description != null && merged.description !== doc.description) throw bad(`${path}'s description differs from another file's (one description for the view)`);
      merged.description = doc.description;
    }
    for (const [key, value] of Object.entries(doc)) {
      if (LISTS.includes(key)) {
        if (!Array.isArray(value)) throw bad(`${path}: ${key} is not a list`);
        for (const item of value) {
          if (key.endsWith('extensions') || item?.name == null) continue;
          const id = `${key}:${key === 'metrics' ? String(item.name).toLowerCase() : item.name}`;
          if (defined.has(id)) throw bad(`${key.replace(/s$/, '')} ${item.name} is in ${defined.get(id)} and ${path}`);
          defined.set(id, path);
        }
        merged[key] = [...(merged[key] ?? []), ...value];
      } else if (key !== 'description' && !(key in merged)) merged[key] = value;
    }
  }
  merged.datasets ??= [];
  return merged;
}
