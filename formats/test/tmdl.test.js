// formats/tmdl.js: a TMDL model read as TMSL, and so as dax-sql's model.
//   - each conformance model, written as TMDL in one file (a script, as Fabric publishes a semantic
//     view) and as a folder (a PBIP's definition/), reads as the model its model.bim reads as:
//     calculated tables and columns, calculation groups, a field parameter, roles, relationships;
//   - Fabric's TMDL of a semantic view (cut from one Fabric wrote) reads as TMSL, property by property;
//   - a calculation group and a role with object-level security, as Power BI writes them;
//   - a text with no model and no table is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { tmslToModel } from '../tmsl.js';
import { tmdlToTmsl, tmdlToModel, tmslToTmdl } from '../tmdl.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/^﻿/, '');
const MODELS = readdirSync(new URL('../../conformance/models/', import.meta.url))
  .map(name => ({ name, bim: JSON.parse(read(`../../conformance/models/${name}/model.bim`)) }));

// The writer is formats/tmdl.js's own (tmslToTmdl): one file, and a folder.
const script = bim => tmslToTmdl(bim);
const folder = bim => tmslToTmdl(bim, { folder: true });

for (const { name, bim } of MODELS) {
  test(`${name}: its model written as TMDL, in one file and as a folder, reads as its model.bim does`, () => {
    const want = tmslToModel(bim);
    assert.deepEqual(tmdlToModel(script(bim)), want, 'one file');
    assert.deepEqual(tmdlToModel(folder(bim)), want, 'a folder, as { path: text }');
    assert.deepEqual(tmdlToModel(Object.values(folder(bim))), want, 'a folder, as its texts');
    // The shared expressions (a Direct Lake model's source), which the model object does not hold.
    const exprs = m => (m.model.expressions ?? []).map(e => [e.name, (Array.isArray(e.expression) ? e.expression.join('\n') : e.expression).trim()]);
    assert.deepEqual(exprs(tmdlToTmsl(script(bim))), exprs(bim), 'expressions, one file');
    assert.deepEqual(exprs(tmdlToTmsl(folder(bim))), exprs(bim), 'expressions, a folder');
  });
}

// --- TMDL as Fabric and Power BI write it --------------------------------------------------------
// Cut from the TMDL Fabric's Publish wrote of a semantic view (SystemContext/Semantic Views/<view>/<view>.tmdl).
const NEM = [
  'createOrReplace',
  '',
  '\tdatabase nem',
  '\t\tid: 07b040f0-a78d-4c1f-a775-7b7f7b772ca6',
  '\t\tcompatibilityLevel: 1606',
  '',
  "\t\t/// Australia's National Electricity Market.",
  '\t\tmodel Model',
  '\t\t\tculture: en-US',
  '\t\t\tdefaultPowerBIDataSourceVersion: powerBI_V3',
  '\t\t\tdataAccessOptions',
  '\t\t\t\tlegacyRedirects',
  '\t\t\t\treturnErrorValuesAsNull',
  '',
  '\t\t\t/// One row per day.',
  '\t\t\ttable dim_calendar',
  '\t\t\t\tlineageTag: bb45a182-e985-4203-bd5a-b8262a48b169',
  '\t\t\t\tsourceLineageTag: [mart].[dim_calendar]',
  '',
  '\t\t\t\tcolumn date',
  '\t\t\t\t\tdataType: dateTime',
  '\t\t\t\t\tformatString: General Date',
  '\t\t\t\t\tlineageTag: a3b763ed-0571-4d79-a713-63e6c36afb84',
  '\t\t\t\t\tsummarizeBy: none',
  '\t\t\t\t\tsourceColumn: date',
  '',
  '\t\t\t\t\tannotation SummarizationSetBy = Automatic',
  '',
  '\t\t\t\tpartition dim_calendar = entity',
  '\t\t\t\t\tmode: directLake',
  '\t\t\t\t\tsource',
  '\t\t\t\t\t\tentityName: dim_calendar',
  '\t\t\t\t\t\tschemaName: mart',
  '\t\t\t\t\t\texpressionSource: SemanticViewSource',
  '',
  '\t\t\t\tannotation PBI_ResultType = Table',
  '',
  "\t\t\ttable 'fct summary'",
  '\t\t\t\tcolumn mw',
  '\t\t\t\t\tdataType: double',
  '\t\t\t\t\tisHidden',
  '\t\t\t\t\tsourceColumn: mw',
  '',
  "\t\t\t\tpartition 'fct summary' = entity",
  '\t\t\t\t\tmode: directLake',
  '\t\t\t\t\tsource',
  '\t\t\t\t\t\tentityName: fct_summary',
  '\t\t\t\t\t\tschemaName: mart',
  '\t\t\t\t\t\texpressionSource: SemanticViewSource',
  '',
  '\t\t\ttable Metrics',
  '\t\t\t\t/// The units in the selection.',
  "\t\t\t\tmeasure 'Registered units' = COUNTROWS('dim_duid')",
  '\t\t\t\t\tlineageTag: fa324e46-a001-4319-84da-a0483808dbe2',
  '',
  '\t\t\t\tmeasure Label = "MW"',
  '\t\t\t\t\tformatString: 0',
  '',
  "\t\t\t\tmeasure 'Generation MWh' =",
  '\t\t\t\t\t\tVAR _last = [Newest whole day]',
  '\t\t\t\t\t\tRETURN',
  '',
  '\t\t\t\t\t\t    IF([Reads 5 minutes], 1, 2)',
  '\t\t\t\t\tlineageTag: 18661cd4-655a-42d9-8b82-f8b1d0b5f740',
  '',
  '\t\t\trelationship fct_summary_to_dim_calendar',
  "\t\t\t\tfromColumn: 'fct summary'.mw",
  '\t\t\t\ttoColumn: dim_calendar.date',
  '',
  '\t\t\trelationship inactive',
  '\t\t\t\tisActive: false',
  '\t\t\t\tfromColumn: dim_calendar.date',
  "\t\t\t\ttoColumn: 'fct summary'.'mw'",
  '',
  '\t\t\texpression SemanticViewSource =',
  '\t\t\t\t\tlet',
  '\t\t\t\t\t    Source = AzureStorage.DataLake("https://onelake.dfs.fabric.microsoft.com/ws/lh", [HierarchicalNavigation=true])',
  '\t\t\t\t\tin',
  '\t\t\t\t\t    Source',
  '\t\t\t\tlineageTag: 9b8f413e-bf15-4119-a6a9-4e57fcc69e94',
  '',
].join('\n');

test("Fabric's TMDL of a semantic view reads as the TMSL of its model", () => {
  const bim = tmdlToTmsl(NEM);
  assert.equal(bim.name, 'nem');
  assert.equal(bim.compatibilityLevel, 1606);
  assert.equal(bim.model.description, "Australia's National Electricity Market.");
  assert.deepEqual(bim.model.tables.map(t => t.name), ['dim_calendar', 'fct summary', 'Metrics']);
  const [cal, fct, metrics] = bim.model.tables;
  assert.equal(cal.lineageTag, undefined, 'lineage is left out');
  assert.deepEqual(cal.columns, [{ name: 'date', dataType: 'dateTime', formatString: 'General Date', summarizeBy: 'none', sourceColumn: 'date' }]);
  assert.deepEqual(cal.partitions, [{ name: 'dim_calendar', mode: 'directLake',
    source: { type: 'entity', entityName: 'dim_calendar', schemaName: 'mart', expressionSource: 'SemanticViewSource' } }]);
  assert.deepEqual(fct.columns, [{ name: 'mw', dataType: 'double', isHidden: true, sourceColumn: 'mw' }], 'a flag alone is true');
  assert.deepEqual(metrics.measures, [
    { name: 'Registered units', expression: "COUNTROWS('dim_duid')", description: 'The units in the selection.' },
    { name: 'Label', expression: '"MW"', formatString: '0' },
    { name: 'Generation MWh', expression: 'VAR _last = [Newest whole day]\nRETURN\n\n    IF([Reads 5 minutes], 1, 2)' },
  ], 'an expression keeps its quotes, and one below its line what is past its indentation');
  assert.deepEqual(bim.model.relationships, [
    { name: 'fct_summary_to_dim_calendar', fromTable: 'fct summary', fromColumn: 'mw', toTable: 'dim_calendar', toColumn: 'date' },
    { name: 'inactive', isActive: false, fromTable: 'dim_calendar', fromColumn: 'date', toTable: 'fct summary', toColumn: 'mw' },
  ]);
  const model = tmdlToModel(NEM);
  assert.deepEqual(model.tables[0].source, { schema: 'mart', entity: 'dim_calendar' });
});

test('a calculation group and a role with object-level security, as Power BI writes them', () => {
  const model = tmdlToModel([
    "table 'Time Calc'",
    '\tcalculationGroup',
    '\t\tprecedence: 10',
    '',
    '\t\tcalculationItem Current = SELECTEDMEASURE()',
    '',
    '\t\tcalculationItem YTD =',
    '\t\t\t\tCALCULATE(SELECTEDMEASURE(),',
    "\t\t\t\t\tDATESYTD('Date'[Date]))",
    '\t\t\tformatStringDefinition = "0.00"',
    '\t\t\tordinal: 1',
    '',
    "\tcolumn 'Time Calc'",
    '\t\tdataType: string',
    '\t\tsourceColumn: Name',
    '\t\tsortByColumn: Ordinal',
    '',
    '\tcolumn Ordinal',
    '\t\tdataType: int64',
    '\t\tsourceColumn: Ordinal',
    '',
    "\tpartition 'Time Calc' = calculationGroup",
    '',
    "role 'West only'",
    '\tmodelPermission: read',
    '',
    '\ttablePermission Customer = Customer[Region] = "West"',
    '',
    '\ttablePermission Product',
    '\t\tmetadataPermission: none',
    '',
    '\ttablePermission Sales',
    '\t\tcolumnPermission Cost',
    '\t\t\tmetadataPermission: none',
    '',
  ].join('\n'));
  assert.deepEqual(model.tables[0].calculationGroup, {
    precedence: 10, multipleOrEmpty: null, noSelection: null, items: [
      { name: 'Current', ordinal: 0, dax: 'SELECTEDMEASURE()', formatString: null },
      { name: 'YTD', ordinal: 1, dax: "CALCULATE(SELECTEDMEASURE(),\n\tDATESYTD('Date'[Date]))", formatString: '"0.00"' },
    ] });
  assert.deepEqual(model.roles, [{ name: 'West only',
    filters: [{ table: 'Customer', dax: 'Customer[Region] = "West"' }, { table: 'Product', dax: '' }, { table: 'Sales', dax: '' }],
    hidden: [{ table: 'Product' }, { table: 'Sales', column: 'Cost' }] }]);
});

test('a text with no model and no table is refused', () => {
  assert.throws(() => tmdlToTmsl('relationship r\n\tfromColumn: a.b\n'), /no model in it/);
});

// tmslToTmdl of a Direct Lake model: its shared expression, the model's mode, what a user sees.
test('tmslToTmdl: a Direct Lake model, its expression and descriptions, read back as it was', () => {
  const bim = { name: 'nem', compatibilityLevel: 1604, model: { culture: 'en-US', defaultMode: 'directLake',
    expressions: [{ name: 'DirectLake', kind: 'm', expression: ['let', '    Source = AzureStorage.DataLake("https://onelake.dfs.fabric.microsoft.com/w/l", [HierarchicalNavigation=true])', 'in', '    Source'] }],
    tables: [{ name: 'Sales Facts', description: 'one row a sale', columns: [
      { name: 'Amount', dataType: 'decimal', sourceColumn: 'amount', isHidden: true, displayFolder: 'Money', formatString: '#,0.00', description: 'net' }],
      measures: [{ name: 'Total', expression: 'SUM(\'Sales Facts\'[Amount])', description: 'all of it' }],
      partitions: [{ name: 'Sales Facts', mode: 'directLake', source: { type: 'entity', entityName: 'sales', schemaName: 'dbo', expressionSource: 'DirectLake' } }] }] } };
  for (const out of [tmslToTmdl(bim), tmslToTmdl(bim, { folder: true })]) {
    const back = tmdlToTmsl(out);
    assert.equal(back.model.defaultMode, 'directLake');
    assert.deepEqual(back.model.expressions.map(e => [e.name, e.expression.trim()]), [['DirectLake', bim.model.expressions[0].expression.join('\n')]]);
    assert.deepEqual(back.model.tables[0].partitions[0].source, bim.model.tables[0].partitions[0].source);
    assert.deepEqual(tmslToModel(back), tmslToModel(bim));
  }
  assert.deepEqual(Object.keys(tmslToTmdl(bim, { folder: true })).sort(), ['database.tmdl', 'expressions.tmdl', 'model.tmdl', 'tables/Sales Facts.tmdl']);
  assert.throws(() => tmslToTmdl({ tables: [] }), e => e.code === 'INPUT');
  assert.throws(() => tmslToTmdl(bim, { folder: 'yes' }), e => e.code === 'INPUT');
});
