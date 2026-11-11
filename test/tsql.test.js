// The T-SQL dialect, as text: every conformance query compiles to T-SQL (or is refused as
// UNSUPPORTED), and none of what Fabric's T-SQL lacks is in it. Whether its answers are DAX's is
// the conformance suite's, run on a Fabric SQL endpoint (conformance/engines/dax-sql-tsql).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCompiler } from '../src/index.js';
import { tmslToModel } from '../formats/tmsl.js';
import { loadQueries, modelDir } from '../conformance/tools/suite.mjs';

// Outside string literals and quoted names.
const code = sql => sql.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"/g, "''");
const LACKS = [
  [/\bNULLS\s+(FIRST|LAST)\b/i, 'NULLS FIRST/LAST'],
  [/\bLATERAL\b/i, 'LATERAL'],
  [/\bFILTER\s*\(\s*WHERE\b/i, 'FILTER (WHERE'],
  [/\bMATERIALIZED\b/i, 'MATERIALIZED'],
  [/::/, '::'],
  [/\b(TRUE|FALSE)\b/i, 'a boolean literal'],
  [/\bLIMIT\b/i, 'LIMIT'],
  [/\bRECURSIVE\b/i, 'WITH RECURSIVE'],
  [/\b(DATE|TIMESTAMP)\s+''/i, 'a DATE literal'],
];

test('every conformance query is T-SQL with nothing Fabric lacks, or refused by name', () => {
  const compilers = new Map();
  let compiled = 0;
  for (const q of loadQueries({})) {
    if (!compilers.has(q.model)) {
      const bim = JSON.parse(readFileSync(`${modelDir(q.model)}/model.bim`, 'utf8'));
      compilers.set(q.model, createCompiler(tmslToModel(bim), { dialect: 'tsql' }));
    }
    let sql;
    try {
      ({ sql } = compilers.get(q.model).compile(q.dax));
    } catch (e) {
      // DAX the compiler refuses on DuckDB too (an error query), or what T-SQL can't write.
      if (e.name === 'DaxError') continue;
      throw new Error(`${q.model}/${q.family}/${q.id}: ${e.message}`);
    }
    compiled++;
    for (const [re, what] of LACKS) assert.doesNotMatch(code(sql), re, `${q.model}/${q.family}/${q.id} writes ${what}:\n${sql}`);
  }
  assert.ok(compiled > 1000, `${compiled} compiled`);
});

test("a whole-number blank is typed, and text compares without regard to case", () => {
  const bim = { model: { tables: [{ name: 'T', columns: [{ name: 'a', dataType: 'string', sourceColumn: 'a' }, { name: 'n', dataType: 'int64', sourceColumn: 'n' }],
    partitions: [{ source: { type: 'entity', entityName: 'T' } }] }] } };
  const c = createCompiler(tmslToModel(bim), { dialect: 'tsql' });
  const { sql } = c.compile('EVALUATE FILTER(T, T[a] = "x" && T[n] <> BLANK())');
  assert.match(sql, /COLLATE Latin1_General_100_CI_AS_KS_WS_SC_UTF8/);
  assert.doesNotMatch(code(sql), /\b(TRUE|FALSE)\b/);
});

test('the default is DuckDB', () => {
  const bim = { model: { tables: [{ name: 'T', columns: [{ name: 'a', dataType: 'string', sourceColumn: 'a' }], partitions: [{ source: { type: 'entity', entityName: 'T' } }] }] } };
  assert.equal(createCompiler(tmslToModel(bim)).dialect.name, 'duckdb');
  assert.equal(createCompiler(tmslToModel(bim), { dialect: 'tsql' }).dialect.name, 'tsql');
});

// What Fabric computes again at each copy (a CTE at each name, a subquery written twice) is
// written once.
const compileAs = (model, dax, dialect = 'tsql') => {
  const bim = JSON.parse(readFileSync(`${modelDir(model)}/model.bim`, 'utf8'));
  return createCompiler(tmslToModel(bim), dialect ? { dialect } : {}).compile(dax).sql;
};
const query = id => loadQueries({}).find(q => q.id === id);
const reads = (sql, table) => sql.split(`FROM "${table}"`).length - 1;

test('SUMMARIZECOLUMNS reads its one fused group once, not joined to itself', () => {
  const q = query('bench-narrow-one-measure');
  assert.equal(reads(compileAs(q.model, q.dax), 'store_sales'), 1);
});

test("a VAR's filter table of a column's values is its conditions, constants a list", () => {
  const dax = `DEFINE VAR F = FILTER(KEEPFILTERS(VALUES(catalog_sales[cache_buster])), catalog_sales[cache_buster] < 2)
    VAR S = TREATAS({"AR", "CA"}, customer_address[ca_state])
    EVALUATE SUMMARIZECOLUMNS(date_dim[d_year], F, S, "q", [Catalog Sales Quantity])`;
  for (const dialect of ['tsql', null]) {
    const sql = compileAs('tpcds', dax, dialect);
    assert.equal(reads(sql, 'catalog_sales'), 1, sql);
    assert.match(sql, /"cache_buster" < 2 OR \w+\."cache_buster" IS NULL/);
    assert.match(sql, /IN \('AR', 'CA'\)/);
  }
});

test('a value that a function names twice is written once: fixed decimals nested stay small', () => {
  const q = query('check-measure-average-price-change');
  assert.ok(compileAs(q.model, q.dax).length < 2 * compileAs(q.model, q.dax, null).length);
});

test("a measure in a column and in another's DIVIDE is one subquery of the row", () => {
  const q = query('paper-q4-catalog-yoy-ar');
  // The quantity's group, and last year's quantity once (it was in three places).
  assert.equal(reads(compileAs(q.model, q.dax), 'catalog_sales'), 2);
  // On DuckDB too, as a LATERAL join.
  const duck = compileAs(q.model, q.dax, null);
  assert.equal(reads(duck, 'catalog_sales'), 2);
  assert.match(duck, /LEFT JOIN LATERAL/);
});
