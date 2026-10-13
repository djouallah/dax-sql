// An Apache Ossie semantic model (https://github.com/apache/ossie, core-spec 0.2.0.dev0) as
// the TMSL model the compiler reads. Ossie carries a measure as a metric in the DAX dialect,
// opaque to it, which is all the compiler needs: datasets are tables, fields columns (a plain
// SQL expression is the source column, a DAX one a calculated column), primary keys key
// columns, relationships many-to-one, and the metrics measures.
// What Ossie has no property for is in a POWER_BI custom extension, as the TMSL properties it
// stands for (JSON), and is laid over the object built here: a relationship's
// crossFilteringBehavior and relyOnReferentialIntegrity, a measure's home table (`table`) and
// formatString, anything else a model needs. A metric with no home table goes on the first
// dataset.
import { semantic } from './errors.js';

const TYPES = { String: 'string', Integer: 'int64', Decimal: 'decimal', Float: 'double', Boolean: 'boolean',
  Date: 'dateTime', Time: 'dateTime', DateTime: 'dateTime', DateTimeTz: 'dateTime', Opaque: 'variant' };

const lc = s => String(s).toLowerCase();

export const isOssie = doc => !!doc && Array.isArray(doc.datasets) && !doc.model;

// The TMSL properties an object's POWER_BI extension holds.
function powerBi(o) {
  const ext = (o.custom_extensions ?? []).find(e => lc(e.vendor_name) === 'power_bi');
  if (!ext) return {};
  try { return JSON.parse(ext.data); } catch { throw semantic(`'${o.name}': its POWER_BI extension is not JSON`); }
}

// The expression of a dialect: DAX if there is one, else the SQL.
function expression(o) {
  const ds = o.expression?.dialects ?? [];
  const dax = ds.find(d => d.dialect === 'DAX');
  if (dax) return { dax: true, text: dax.expression };
  const sql = ds[0];
  if (!sql) throw semantic(`'${o.name}' has no expression`);
  return { dax: false, text: sql.expression };
}

export function fromOssie(doc) {
  const tables = doc.datasets.map(d => {
    const keys = new Set((d.primary_key?.length === 1 ? d.primary_key : []).map(lc));
    const dot = d.source.lastIndexOf('.');
    const entity = { type: 'entity', entityName: d.source.slice(dot + 1) };
    if (dot > 0) entity.schemaName = d.source.slice(0, dot);
    return {
      name: d.name,
      columns: (d.fields ?? []).map(f => {
        const e = expression(f);
        const c = { name: f.name, dataType: TYPES[f.datatype] ?? 'variant' };
        if (e.dax) Object.assign(c, { type: 'calculated', expression: e.text });
        else c.sourceColumn = e.text.trim().replace(/^"(.*)"$/, '$1');
        if (keys.has(lc(f.name))) c.isKey = true;
        return { ...c, ...powerBi(f) };
      }),
      measures: [],
      partitions: [{ name: d.name, source: entity }],
      ...powerBi(d),
    };
  });
  if (!tables.length) throw semantic('the Ossie model has no datasets');
  const byName = new Map(tables.map(t => [lc(t.name), t]));
  for (const m of doc.metrics ?? []) {
    const e = expression(m);
    if (!e.dax) throw semantic(`metric '${m.name}' has no DAX expression`);
    const { table, ...rest } = powerBi(m);
    const home = table == null ? tables[0] : byName.get(lc(table));
    if (!home) throw semantic(`metric '${m.name}': the model has no table '${table}'`);
    home.measures.push({ name: m.name, expression: e.text, ...rest });
  }
  const relationships = (doc.relationships ?? []).map(r => {
    if (r.from_columns.length !== 1 || r.to_columns.length !== 1) throw semantic(`relationship '${r.name}': a relationship joins one column`);
    return { name: r.name, fromTable: r.from, fromColumn: r.from_columns[0], toTable: r.to, toColumn: r.to_columns[0], ...powerBi(r) };
  });
  return { name: doc.name, model: { tables, relationships, ...powerBi(doc) } };
}
