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

// What a model's user sees of an object (describe() lists it): its description, display folder,
// format string and whether it is hidden, where the TMSL says.
const shown = o => ({
  ...(o.isHidden ? { hidden: true } : {}),
  ...(o.description != null ? { description: text(o.description) } : {}),
  ...(o.displayFolder ? { displayFolder: o.displayFolder } : {}),
});
// Power BI's auto date/time tables (a LocalDateTable_<guid> for each date column, the
// DateTableTemplate_<guid> they are made from): by their annotation, else their name.
const AUTO_DATE = /^(LocalDateTable|DateTableTemplate)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const autoDate = t => (t.annotations ?? []).some(a => a.name === '__PBI_LocalDateTable' || a.name === '__PBI_TemplateDateTable') || AUTO_DATE.test(t.name);

function table(t) {
  const out = { name: t.name, hidden: !!t.isHidden };
  if (t.description != null) out.description = text(t.description);
  if (autoDate(t)) out.autoDate = true;
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
    ...shown(c),
    ...(c.formatString ? { formatString: c.formatString } : {}),
  }));
  out.measures = (t.measures ?? []).map(m => {
    const sql = ossieSql(m);
    return { name: m.name, dax: text(m.expression), formatString: m.formatString ?? null, ...(sql != null ? { sql } : {}), ...shown(m) };
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
  // The model's name: the document's (a database's, an Ossie document's), else its model's.
  const name = (bim.model ? bim.name : null) ?? m.name ?? null;
  return {
    ...(name != null ? { name: String(name) } : {}),
    ...(m.description != null ? { description: text(m.description) } : {}),
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

// A Fabric SQL endpoint's expression: Sql.Database("<label>-<workspace label>.datawarehouse.…",
// "<endpoint GUID>"), each label a GUID's 16 bytes in base32 (RFC 4648, a-z2-7).
const SQL_DATABASE = /Sql\.Database\s*\(\s*"[a-z2-7]{26}-([a-z2-7]{26})\.datawarehouse\.[^"]*"\s*,\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"\s*\)/i;
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
// A label as the GUID it writes: its first three groups little-endian, as a GUID's bytes are.
function guidOfLabel(label) {
  let bits = 0, held = 0;
  const b = [];
  for (const c of lc(label)) {
    bits = (bits << 5) | BASE32.indexOf(c);
    held += 5;
    if (held >= 8) { held -= 8; b.push((bits >> held) & 255); bits &= (1 << held) - 1; }
  }
  const h = b.slice(0, 16).map(x => x.toString(16).padStart(2, '0'));
  return `${h[3]}${h[2]}${h[1]}${h[0]}-${h[5]}${h[4]}-${h[7]}${h[6]}-${h[8]}${h[9]}-${h.slice(10).join('')}`;
}
// A partition's mode, lower-cased: the model's defaultMode where it says none or default (Import
// when the model says none either).
const modeOf = (p, model) => lc(!p.mode || lc(p.mode) === 'default' ? (model.defaultMode || 'import') : p.mode);
// A table's partition of the rows of a named table (an entity), not a calculation or M.
const entityOf = t => {
  const s = t.partitions?.[0]?.source;
  return s && (s.type === 'entity' || (s.type == null && s.entityName != null)) ? s : null;
};

// A Direct Lake model's tables in OneLake, by lower-cased table name:
//   { workspace, item, schema, entity }          a partition reading a shared expression whose
//     AzureStorage.DataLake URL names the lakehouse by GUIDs (schema `dbo`, entity the table's
//     name, unless the partition says);
//   { workspace, endpoint, schema, entity, viaSqlEndpoint: true }  a Direct Lake partition (its
//     mode, else the model's defaultMode) reading a shared expression Sql.Database of a Fabric
//     SQL endpoint: its workspace and the endpoint, by GUIDs (which item is behind the endpoint is
//     Fabric's to say); an Import or DirectQuery partition reading one is not in it;
//   { item, schema, entity, inWorkspace: true }  a partition with no expression whose schema is
//     item.schema (ossieToTmsl's for a source item.schema.table): the item of that name in the
//     model's own workspace.
// A table it places none of these ways is not in it: unplacedTables lists those of no expression.
// It takes the document ({ model }) or its model.
export function directLakeTables(bim) {
  const model = bim?.model ?? bim ?? {};
  const lakes = new Map(), endpoints = new Map();
  for (const e of model.expressions ?? []) {
    const m = ONELAKE.exec(String(text(e.expression)));
    if (m) lakes.set(e.name, { workspace: lc(m[1]), item: lc(m[2]) });
    const q = SQL_DATABASE.exec(String(text(e.expression)));
    if (q) endpoints.set(e.name, { workspace: guidOfLabel(q[1]), endpoint: lc(q[2]) });
  }
  const out = new Map();
  for (const t of model.tables ?? []) {
    const p = t.partitions?.[0], s = p?.source;
    if (!s) continue;
    // Each part a name, unquoted: an entity written quoted (a TMSL of dax-sql before 0.3) too.
    const entity = unquote(s.entityName ?? t.name);
    const lake = s.expressionSource && lakes.get(s.expressionSource);
    if (lake) { out.set(lc(t.name), { ...lake, schema: unquote(s.schemaName ?? 'dbo'), entity }); continue; }
    const sql = s.expressionSource && endpoints.get(s.expressionSource);
    if (sql) {
      if (modeOf(p, model) === 'directlake') out.set(lc(t.name), { ...sql, schema: unquote(s.schemaName ?? 'dbo'), entity, viaSqlEndpoint: true });
      continue;
    }
    if (s.expressionSource || !s.entityName || !s.schemaName) continue;
    const parts = nameParts(s.schemaName);
    if (parts.length === 2) out.set(lc(t.name), { item: unquote(parts[0]), schema: unquote(parts[1]), entity, inWorkspace: true });
  }
  return out;
}

// The tables of a model that nothing places, by lower-cased table name: { schema, entity }, a
// partition of a named table (an entity) with no expression and no item.schema name, such as a
// Fabric semantic view's source dbo.sales read with no catalog. Which lakehouse holds them is the
// host's to ask. With directLakeTables, every entity table of a model is in one or the other, or
// reads an expression that is neither OneLake's nor a Fabric SQL endpoint's.
export function unplacedTables(bim) {
  const model = bim?.model ?? bim ?? {};
  const placed = directLakeTables(model);
  const out = new Map();
  for (const t of model.tables ?? []) {
    const s = entityOf(t);
    if (!s || s.expressionSource || placed.has(lc(t.name))) continue;
    out.set(lc(t.name), { schema: unquote(s.schemaName ?? 'dbo'), entity: unquote(s.entityName ?? t.name) });
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
