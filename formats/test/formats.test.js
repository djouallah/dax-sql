// The readers of formats/: TMSL (tmsl.js) and Apache Ossie (ossie.js). On the contoso model
// (test/fixtures: calculated tables, calculation groups, a field parameter, roles, inactive
// and many-to-many relationships) and the aac one (conformance/models/aac):
//   - TMSL -> Ossie -> TMSL is the model, every property of it;
//   - conformance/models/aac/ossie.yaml is its model.bim as Ossie;
//   - the compiler gives the same SQL from either reading of a model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { createCompiler } from '../../src/index.js';
import { tmslToModel } from '../tmsl.js';
import { tmslToOssie, ossieToTmsl, ossieToModel } from '../ossie.js';
import { bim as contoso } from '../../test/fixtures/contoso.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/^﻿/, '');
const aac = JSON.parse(read('../../conformance/models/aac/model.bim'));

// An expression or a description written as an array of lines is the lines joined.
const joined = (k, x) => (k === 'expression' || k === 'description') && Array.isArray(x) && x.every(s => typeof s === 'string');
const lines = v => (Array.isArray(v) ? v.map(lines)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, joined(k, x) ? x.join('\n') : lines(x)])) : v);

const CONTOSO = [
  'EVALUATE SUMMARIZECOLUMNS(Product[Color], "s", [Sales Amount])',
  'EVALUATE SUMMARIZECOLUMNS(Category[Category], Customer[City], "s", [Sales Amount], "o", [Orders])',
  'EVALUATE ROW("u", CALCULATE([Sales Amount], USERELATIONSHIP(Sales[ShipDate], \'Date\'[Date])), "c", CALCULATE(COUNTROWS(Customer), CROSSFILTER(Sales[CustomerKey], Customer[CustomerKey], BOTH)))',
  'EVALUATE SUMMARIZECOLUMNS(\'Date\'[Year], \'Date\'[Month], "ytd", TOTALYTD([Sales Amount], \'Date\'[Date]))',
  'EVALUATE SUMMARIZECOLUMNS(Customer[City], "t", [Target])',
  'EVALUATE SUMMARIZECOLUMNS(\'Time Calc\'[Time Calc], "s", [Sales Amount])',
  'EVALUATE SUMMARIZECOLUMNS(Scale[Scale], \'Time Calc\'[Time Calc], "s", [Sales Amount])',
  'EVALUATE SUMMARIZECOLUMNS(\'Big Products\'[Name], "s", [Sales Amount])',
  'EVALUATE SUMMARIZECOLUMNS(Fields[Fields], "s", [Sales Amount])',
];

for (const [name, bim] of [['contoso', contoso], ['aac', aac]]) {
  test(`${name}: TMSL -> Ossie -> TMSL is the model`, () => {
    assert.deepEqual(lines(ossieToTmsl(tmslToOssie(bim))), lines(bim));
  });
}

test('aac: ossie.yaml is its model.bim as Ossie', () => {
  assert.deepEqual(parse(read('../../conformance/models/aac/ossie.yaml')), tmslToOssie(aac, 'aac'));
});

test('contoso: the same SQL from TMSL and from Ossie, roles included', () => {
  const ossie = tmslToOssie(contoso);
  for (const roles of [undefined, 'Paris']) {
    const [a, b] = [tmslToModel(contoso), ossieToModel(ossie)].map(m => createCompiler(m, roles ? { roles } : {}));
    for (const q of CONTOSO) assert.equal(b.compile(q).sql, a.compile(q).sql, q);
  }
});

test('aac: the same SQL from TMSL and from Ossie, every measure', () => {
  const opts = { tableSource: t => `v_${t.name}` };
  const [a, b] = [tmslToModel(aac), ossieToModel(parse(read('../../conformance/models/aac/ossie.yaml')))].map(m => createCompiler(m, opts));
  const measures = aac.model.tables.flatMap(t => (t.measures ?? []).map(m => m.name));
  assert.ok(measures.length > 40);
  for (const m of measures) for (const q of [`EVALUATE ROW("v", [${m}])`,
    `EVALUATE SUMMARIZECOLUMNS(dim_region[Region], dim_calendar[month], "v", [${m}])`,
    `EVALUATE CALCULATETABLE(SUMMARIZECOLUMNS(dim_region[Region], "v", [${m}]), dim_duid[FuelSourceDescriptor] = "Wind")`]) {
    assert.equal(b.compile(q).sql, a.compile(q).sql, q);
  }
});

test('an Ossie metric with no DAX is refused', () => {
  const doc = tmslToOssie(contoso);
  doc.metrics = [{ name: 'x', expression: { dialects: [{ dialect: 'ANSI_SQL', expression: 'SUM(a)' }] } }];
  assert.throws(() => ossieToTmsl(doc), /no DAX expression/);
});
