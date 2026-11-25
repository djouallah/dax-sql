// Every dialect, as text: every conformance query compiles to its SQL, or is refused with a
// DaxError (the dialect can't write it), never with an exception of the compiler's own; and its
// query plan draws, every way it can be made. Whether the answers are DAX's is the conformance
// suite's, on each engine (postgres.yml, polars.yml, datafusion.yml, tsql.yml); T-SQL's shapes
// are tsql.test.js's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCompiler, DaxError } from '../src/index.js';
import { tmslToModel } from '../formats/tmsl.js';
import { loadQueries, readBim } from '../conformance/tools/suite.mjs';

const queries = loadQueries({});
const compilerFor = dialect => {
  const cs = new Map();
  return q => {
    const k = `${q.model}|${q.roles?.join(',') ?? ''}`;
    if (!cs.has(k)) cs.set(k, createCompiler(tmslToModel(readBim(q.model)), { dialect, columnNames: 'dax', ...(q.roles ? { roles: q.roles } : {}) }));
    return cs.get(k);
  };
};

for (const dialect of ['postgres', 'polars', 'datafusion']) {
  test(`${dialect}: every conformance query is its SQL, or refused with a DaxError`, () => {
    const of = compilerFor(dialect), raw = [];
    let compiled = 0;
    for (const q of queries) {
      try { of(q).compile(q.dax); compiled++; } catch (e) { if (!(e instanceof DaxError)) raw.push(`${q.model}/${q.family}/${q.id}: ${e.constructor.name}: ${e.message.split('\n')[0]}`); }
    }
    assert.deepEqual(raw, []);
    assert.ok(compiled > queries.length * 0.9, `${compiled} of ${queries.length} compiled`);
  });
}

test('every conformance query\'s plan draws: as lowered, correlated, unnested and optimized', () => {
  const of = compilerFor('duckdb'), raw = [];
  for (const q of queries) {
    for (const o of [{ optimize: false }, { correlated: true }, { unnest: true }, {}]) {
      try { assert.equal(typeof of(q).explain(q.dax, o), 'string'); } catch (e) { if (!(e instanceof DaxError)) raw.push(`${q.model}/${q.family}/${q.id} ${JSON.stringify(o)}: ${e.message.split('\n')[0]}`); }
    }
  }
  assert.deepEqual(raw, []);
});
