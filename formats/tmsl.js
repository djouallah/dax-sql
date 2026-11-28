// A TMSL model (model.bim, the JSON of Power BI and Analysis Services) as dax-sql's model
// object (src/model.js says its shape). Not part of the package: a reader of one format.
//   import { tmslToModel } from 'dax-sql/formats/tmsl.js';
//   createCompiler(tmslToModel(JSON.parse(text)))
// It takes the parsed JSON, the document ({ model: ... }) or its model.

const TYPES = { string: 'string', int64: 'int', double: 'double', decimal: 'decimal', dateTime: 'datetime',
  boolean: 'bool', binary: 'string', variant: 'variant', unknown: 'variant' };

const text = e => (Array.isArray(e) ? e.join('\n') : e ?? '');
const expr = e => (e == null ? null : text(e.expression ?? e));
// The SQL of the Apache Ossie metric a measure was read from (formats/ossie.js keeps it in an
// `Ossie` annotation), while its DAX is still the one it was read as: a query over the model's
// datasets follows its rules (a COUNT is 0 over no rows, NULLIF(COUNT(..), 0) is not).
function ossieSql(m) {
  const a = (m.annotations ?? []).find(x => x.name === 'Ossie');
  let was;
  try { was = a ? JSON.parse(a.value) : null; } catch { return null; }
  const e = was?.expression;
  if (!e || was.dax !== text(m.expression)) return null;
  return e.sql ?? e.dialects?.find(d => d.dialect !== 'DAX')?.expression ?? null;
}

function table(t) {
  const out = { name: t.name, hidden: !!t.isHidden };
  if (t.dataCategory) out.dataCategory = t.dataCategory;
  const s = t.partitions?.[0]?.source;
  if (s?.type === 'calculated') out.dax = text(s.expression);
  else if (s?.type === 'entity' || s?.entityName) out.source = { schema: s.schemaName ?? null, entity: s.entityName };
  // A key of several columns: Ossie's (formats/ossie.js), its names in the table's PrimaryKey.
  const keyOf = JSON.parse((t.annotations ?? []).find(x => x.name === 'PrimaryKey')?.value ?? '[]');
  out.columns = (t.columns ?? []).filter(c => c.type !== 'rowNumber').map(c => ({
    name: c.name,
    type: TYPES[c.dataType] ?? 'variant',
    source: c.sourceColumn ?? c.name,
    ...(c.type === 'calculated' ? { dax: text(c.expression) } : {}),
    key: !!c.isKey || keyOf.includes(c.name),
    nullable: c.isNullable !== false,
    ...(c.dataCategory ? { dataCategory: c.dataCategory } : {}),
    // Power BI marks the fields column of a field parameter in its extended properties.
    fieldParameter: (c.extendedProperties ?? []).some(p => p.name === 'ParameterMetadata'),
  }));
  out.measures = (t.measures ?? []).map(m => {
    const sql = ossieSql(m);
    return { name: m.name, dax: text(m.expression), formatString: m.formatString ?? null, ...(sql != null ? { sql } : {}) };
  });
  const g = t.calculationGroup;
  if (g) out.calculationGroup = {
    precedence: g.precedence ?? 0,
    items: (g.calculationItems ?? []).map((it, i) => ({ name: it.name, ordinal: it.ordinal ?? i, dax: text(it.expression),
      formatString: expr(it.formatStringDefinition) })),
    multipleOrEmpty: expr(g.multipleOrEmptySelectionExpression),
    noSelection: expr(g.noSelectionExpression),
  };
  return out;
}

const relationship = (r, i) => ({
  name: r.name ?? `rel${i}`,
  from: { table: r.fromTable, column: r.fromColumn },
  to: { table: r.toTable, column: r.toColumn },
  active: r.isActive !== false,
  crossFilter: r.crossFilteringBehavior === 'bothDirections' ? 'both' : 'single',
  fromCardinality: r.fromCardinality ?? 'many',
  toCardinality: r.toCardinality ?? 'one',
  assumeIntegrity: !!r.relyOnReferentialIntegrity,
  securityFilter: r.securityFilteringBehavior === 'bothDirections' ? 'both' : r.securityFilteringBehavior === 'none' ? 'none' : 'single',
});

export function tmslToModel(bim) {
  const m = bim.model ?? bim;
  if (!Array.isArray(m?.tables)) throw new Error('not a TMSL model: it has no tables');
  return {
    tables: m.tables.map(table),
    relationships: (m.relationships ?? []).map(relationship),
    roles: (m.roles ?? []).map(r => ({
      name: r.name,
      filters: (r.tablePermissions ?? []).map(p => ({ table: p.name, dax: text(p.filterExpression) })),
      // Object-level security: the tables and the columns the role hides.
      hidden: (r.tablePermissions ?? []).flatMap(p => [
        ...(p.metadataPermission === 'none' ? [{ table: p.name }] : []),
        ...(p.columnPermissions ?? []).filter(c => c.metadataPermission === 'none').map(c => ({ table: p.name, column: c.name })),
      ]),
    })),
  };
}

// --- Where a model's data is (for a host; dax-sql compiles whatever tableSource names) ---------

const lc = s => String(s).toLowerCase();
// A dotted SQL name's parts as written ("my ws" keeps its quotes), and one without its quotes.
const nameParts = ident => String(ident).match(/"(?:[^"]|"")*"|[^.]+/g) ?? [];
const unquote = p => (p.startsWith('"') ? p.slice(1, -1).replace(/""/g, '"') : p);
const ONELAKE = /onelake\.dfs\.fabric\.microsoft\.com\/([0-9a-f-]{36})\/([0-9a-f-]{36})/i;

// A Direct Lake model's tables in OneLake, by lower-cased table name:
//   { workspace, item, schema, entity }          a partition reading a shared expression whose
//     AzureStorage.DataLake URL names the lakehouse by GUIDs (schema `dbo`, entity the table's
//     name, unless the partition says);
//   { item, schema, entity, inWorkspace: true }  a partition with no expression whose schema is
//     item.schema (ossieToTmsl's for a source item.schema.table): the item of that name in the
//     model's own workspace.
// A table it places neither way is not in it. It takes the document ({ model }) or its model.
export function directLakeTables(bim) {
  const model = bim?.model ?? bim ?? {};
  const lakes = new Map();
  for (const e of model.expressions ?? []) {
    const m = ONELAKE.exec(String(text(e.expression)));
    if (m) lakes.set(e.name, { workspace: lc(m[1]), item: lc(m[2]) });
  }
  const out = new Map();
  for (const t of model.tables ?? []) {
    const s = t.partitions?.[0]?.source;
    if (!s) continue;
    const lake = s.expressionSource && lakes.get(s.expressionSource);
    if (lake) { out.set(lc(t.name), { ...lake, schema: s.schemaName ?? 'dbo', entity: s.entityName ?? t.name }); continue; }
    if (s.expressionSource || !s.entityName || !s.schemaName) continue;
    const parts = nameParts(s.schemaName);
    if (parts.length === 2) out.set(lc(t.name), { item: unquote(parts[0]), schema: unquote(parts[1]), entity: s.entityName, inWorkspace: true });
  }
  return out;
}

// How a model stores its tables: 'directlake', 'import', 'directquery', 'dual', or 'composite'
// (partitions of more than one mode). A partition with no mode (or 'default') takes the model's
// defaultMode, Import when it has none; a calculated table or calculation group has no storage of
// its own and does not count.
export function storageMode(bim) {
  const model = bim?.model ?? bim ?? {};
  const fallback = lc(model.defaultMode || 'import');
  const modes = new Set();
  for (const t of model.tables ?? []) {
    for (const p of t.partitions ?? []) {
      if (p.source?.type === 'calculated' || p.source?.type === 'calculationGroup') continue;
      const m = lc(p.mode || 'default');
      modes.add(m === 'default' ? fallback : m);
    }
  }
  if (!modes.size) modes.add(fallback);
  if (modes.size > 1) return 'composite';
  const [m] = modes;
  return ['directlake', 'import', 'directquery', 'dual'].includes(m) ? m : 'import';
}
