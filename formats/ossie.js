// An Apache Ossie semantic model (https://github.com/apache/ossie, core-spec 0.2.0.dev0) whose
// metrics are DAX, and TMSL, either way, and as dax-sql's model object. Not part of the
// package: a reader of one format. It takes and gives parsed objects; parsing YAML is the
// caller's.
//   tmslToOssie(bim)    a model.bim as Ossie
//   ossieToTmsl(doc)    the model.bim an Ossie document stands for
//   ossieToModel(doc)   dax-sql's model object (createCompiler takes it)
// Tables are datasets, columns fields (the source column in ANSI_SQL, a calculated column's
// DAX in DAX), key columns the primary key, relationships relationships, measures metrics in
// the DAX dialect. Every TMSL property that has no place in Ossie (a relationship's
// crossFilteringBehavior, a measure's table and format string, the partitions, the roles,
// ...) is kept in the object's POWER_BI custom extension, as the TMSL properties (JSON): it
// is a deny-list, so ossieToTmsl(tmslToOssie(bim)) is the bim (an expression written as an
// array of lines comes back as one string).
import { tmslToModel } from './tmsl.js';

const VERSION = '0.2.0.dev0';
const VENDOR = 'POWER_BI';
const text = e => (Array.isArray(e) ? e.join('\n') : e);
const TO_OSSIE = { string: 'String', int64: 'Integer', decimal: 'Decimal', double: 'Float', boolean: 'Boolean' };
const TO_TMSL = { String: 'string', Integer: 'int64', Decimal: 'decimal', Float: 'double', Boolean: 'boolean', Date: 'dateTime', DateTime: 'dateTime' };
// A dateTime column whose format has no time of day is a date.
const datatype = c => (c.dataType === 'dateTime' ? (/[Hhms]/.test(c.formatString ?? 'H') ? 'DateTime' : 'Date') : TO_OSSIE[c.dataType]);

// The properties of `o` not in `used`: what goes in the extension.
const rest = (o, used) => Object.fromEntries(Object.entries(o).filter(([k]) => !used.includes(k)));
const ext = data => (Object.keys(data).length ? { custom_extensions: [{ vendor_name: VENDOR, data: JSON.stringify(data) }] } : {});
function powerBi(o) {
  const e = (o.custom_extensions ?? []).find(x => String(x.vendor_name).toUpperCase() === VENDOR);
  return e ? JSON.parse(e.data) : {};
}
const optional = (k, v) => (v == null ? {} : { [k]: v });

function field(c) {
  const calculated = c.type === 'calculated';
  const left = rest(c, ['name', 'description', 'expression', 'sourceColumn', 'isKey']);
  if (calculated) delete left.type;
  else if (c.sourceColumn == null) left.sourceColumn = null;
  if (c.isKey === false) left.isKey = false;
  // The type is the field's when it reads back as the same TMSL type.
  const type = datatype(c);
  if (c.dataType != null && TO_TMSL[type] === c.dataType) delete left.dataType;
  return {
    name: c.name,
    expression: { dialects: [calculated
      ? { dialect: 'DAX', expression: text(c.expression) }
      : { dialect: 'ANSI_SQL', expression: c.sourceColumn ?? c.name }] },
    ...optional('datatype', type),
    ...optional('description', text(c.description)),
    ...ext(left),
  };
}

function dataset(t) {
  const s = t.partitions?.[0]?.source;
  const keys = (t.columns ?? []).filter(c => c.isKey === true).map(c => c.name);
  return {
    name: t.name,
    source: s?.entityName ? (s.schemaName ? `${s.schemaName}.${s.entityName}` : s.entityName) : t.name,
    ...(keys.length ? { primary_key: keys } : {}),
    ...optional('description', text(t.description)),
    fields: (t.columns ?? []).map(field),
    // An empty list of measures has no metric to come back from.
    ...ext(rest(t, ['name', 'description', 'columns', ...(t.measures?.length ? ['measures'] : [])])),
  };
}

export function tmslToOssie(bim, name = 'model') {
  const m = bim.model;
  const doc = rest(bim, ['name', 'model']);
  if (bim.name == null) doc.name = null;
  return {
    version: VERSION,
    name: bim.name ?? name,
    ...optional('description', text(m.description)),
    datasets: m.tables.map(dataset),
    ...(m.relationships ? { relationships: m.relationships.map((r, i) => {
      const left = rest(r, ['name', 'fromTable', 'fromColumn', 'toTable', 'toColumn']);
      if (r.name == null) left.name = null;
      return {
        name: r.name ?? `rel${i}`, from: r.fromTable, to: r.toTable, from_columns: [r.fromColumn], to_columns: [r.toColumn],
        ...ext(left),
      };
    }) } : {}),
    metrics: m.tables.flatMap(t => (t.measures ?? []).map(ms => ({
      name: ms.name,
      expression: { dialects: [{ dialect: 'DAX', expression: text(ms.expression) ?? '' }] },
      ...optional('description', text(ms.description)),
      ...ext({ table: t.name, ...rest(ms, ['name', 'description', 'expression']) }),
    }))),
    ...ext({ ...doc, model: rest(m, ['description', 'tables', 'relationships']) }),
  };
}

const dax = o => o.expression?.dialects?.find(d => d.dialect === 'DAX')?.expression;
const sql = o => o.expression?.dialects?.find(d => d.dialect !== 'DAX')?.expression;
// Back: what the core says, and the extension over it; a property it holds as null is one
// the TMSL did not have.
const tmsl = (core, extra) => Object.fromEntries(Object.entries({ ...core, ...extra }).filter(([, v]) => v !== null && v !== undefined));

export function ossieToTmsl(doc) {
  const { model: modelExtra = {}, ...docExtra } = powerBi(doc);
  const tables = doc.datasets.map(d => {
    const keys = new Set(d.primary_key ?? []);
    const extra = powerBi(d);
    const [schema, entity] = d.source.includes('.') ? [d.source.slice(0, d.source.lastIndexOf('.')), d.source.slice(d.source.lastIndexOf('.') + 1)] : [null, d.source];
    return tmsl({
      name: d.name,
      description: d.description,
      columns: (d.fields ?? []).map(f => {
        const e = powerBi(f), code = dax(f);
        return tmsl({
          name: f.name,
          description: f.description,
          dataType: TO_TMSL[f.datatype],
          ...(code != null ? { type: 'calculated', expression: code } : { sourceColumn: sql(f) }),
          ...(keys.has(f.name) ? { isKey: true } : {}),
        }, e);
      }),
      ...(extra.partitions ? {} : { partitions: [{ name: d.name, source: tmsl({ type: 'entity', entityName: entity, schemaName: schema }, {}) }] }),
    }, extra);
  });
  const byName = new Map(tables.map(t => [t.name.toLowerCase(), t]));
  for (const m of doc.metrics ?? []) {
    const { table, ...extra } = powerBi(m);
    const code = dax(m);
    if (code == null) throw new Error(`metric '${m.name}' has no DAX expression`);
    const home = table == null ? tables[0] : byName.get(String(table).toLowerCase());
    if (!home) throw new Error(`metric '${m.name}': the model has no table '${table}'`);
    (home.measures ??= []).push(tmsl({ name: m.name, description: m.description, expression: code }, extra));
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
