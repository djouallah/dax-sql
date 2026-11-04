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
