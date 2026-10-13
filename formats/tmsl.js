// A TMSL model (model.bim, the JSON of Power BI and Analysis Services) as dax-sql's model
// object (src/model.js says its shape). Not part of the package: a reader of one format.
//   import { tmslToModel } from 'dax-sql/formats/tmsl.js';
//   createCompiler(tmslToModel(JSON.parse(text)))
// It takes the parsed JSON, the document ({ model: ... }) or its model.

const TYPES = { string: 'string', int64: 'int', double: 'double', decimal: 'decimal', dateTime: 'datetime',
  boolean: 'bool', binary: 'string', variant: 'variant', unknown: 'variant' };

const text = e => (Array.isArray(e) ? e.join('\n') : e ?? '');
const expr = e => (e == null ? null : text(e.expression ?? e));

function table(t) {
  const out = { name: t.name, hidden: !!t.isHidden };
  if (t.dataCategory) out.dataCategory = t.dataCategory;
  const s = t.partitions?.[0]?.source;
  if (s?.type === 'calculated') out.dax = text(s.expression);
  else if (s?.type === 'entity' || s?.entityName) out.source = { schema: s.schemaName ?? null, entity: s.entityName };
  out.columns = (t.columns ?? []).filter(c => c.type !== 'rowNumber').map(c => ({
    name: c.name,
    type: TYPES[c.dataType] ?? 'variant',
    source: c.sourceColumn ?? c.name,
    ...(c.type === 'calculated' ? { dax: text(c.expression) } : {}),
    key: !!c.isKey,
    nullable: c.isNullable !== false,
    ...(c.dataCategory ? { dataCategory: c.dataCategory } : {}),
    // Power BI marks the fields column of a field parameter in its extended properties.
    fieldParameter: (c.extendedProperties ?? []).some(p => p.name === 'ParameterMetadata'),
  }));
  out.measures = (t.measures ?? []).map(m => ({ name: m.name, dax: text(m.expression), formatString: m.formatString ?? null }));
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
    })),
  };
}
