// DAX that DAX itself rejects, and the compiler must too (a SEMANTIC error, not rows): a
// PARTITIONBY on an added column, a natural join on columns of different data types, and a
// secured table that a CROSSFILTER lets filter itself back. On the model of fixtures/contoso.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCompiler } from '../src/index.js';
import { bim } from './fixtures/contoso.js';

const semantic = re => e => e.code === 'SEMANTIC' && re.test(e.message);

test('PARTITIONBY cannot name a column a table function added', () => {
  const dax = createCompiler(bim);
  const t = 'ADDCOLUMNS(VALUES(Product[Name]), "Band", IF(CALCULATE(MAX(Product[Price])) >= 100, "High"), "s", [Sales Amount])';
  assert.throws(() => dax.compile(`EVALUATE VAR t = ${t} RETURN ADDCOLUMNS(t, "r", RANK(DENSE, t, ORDERBY([s], DESC), PARTITIONBY([Band])))`),
    semantic(/PARTITIONBY cannot be used with columns added/));
  // ORDERBY can, and PARTITIONBY a model column.
  assert.doesNotThrow(() => dax.compile(`EVALUATE VAR t = ${t} RETURN ADDCOLUMNS(t, "r", RANK(DENSE, t, ORDERBY([s], DESC), PARTITIONBY(Product[Name])))`));
});

test('the natural joins: columns joined by name must have the same data type; MAXX of text is a variant', () => {
  const dax = createCompiler(bim);
  const keys = 'SELECTCOLUMNS(Product, "k", Product[CategoryKey] + 0, "Name", Product[Name])';
  assert.throws(() => dax.compile(`EVALUATE NATURALINNERJOIN(SELECTCOLUMNS(Category, "k", Category[CategoryKey] & ""), ${keys})`),
    semantic(/join column \[k\] has different data types/));
  assert.doesNotThrow(() => dax.compile(`EVALUATE NATURALINNERJOIN(SELECTCOLUMNS(Category, "k", Category[CategoryKey] * 1), ${keys})`));
  const top = 'SELECTCOLUMNS(Category, "Name", CALCULATE(MAXX(Product, Product[Name])))';
  assert.throws(() => dax.compile(`EVALUATE NATURALLEFTOUTERJOIN(${top}, SELECTCOLUMNS(Product, "Name", Product[Name] & ""))`),
    semantic(/join column \[Name\] has different data types/));
});

test('row-level security: a CROSSFILTER that lets a secured table filter itself back is an error', () => {
  const both = 'CALCULATE(COUNTROWS(Customer), CROSSFILTER(Sales[CustomerKey], Customer[CustomerKey], BOTH))';
  // Customer is secured: it reaches itself directly and through Sales.
  assert.throws(() => createCompiler(bim, { roles: 'Paris' }).compile(`EVALUATE ROW("n", ${both})`),
    semantic(/two join paths to 'Customer'.*'Customer'->'Sales'->'Customer'/));
  // Product is secured: it reaches Customer through Sales only.
  assert.doesNotThrow(() => createCompiler(bim, { roles: 'RedOnly' }).compile(`EVALUATE ROW("n", ${both})`));
  // Without the CROSSFILTER, or without security, nothing doubles back.
  assert.doesNotThrow(() => createCompiler(bim, { roles: 'Paris' }).compile('EVALUATE ROW("n", COUNTROWS(Customer))'));
  assert.doesNotThrow(() => createCompiler(bim).compile(`EVALUATE ROW("n", ${both})`));
});
