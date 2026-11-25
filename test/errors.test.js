// Any text answers with SQL or a DaxError, never an exception of the compiler's own:
//   - every function of the library, and every modifier of CALCULATE, called with 0 to 4
//     arguments of each kind, on every dialect;
//   - too few arguments: DAX's error, in Power BI's words;
//   - queries of the suite broken on purpose (conformance/tools/mutate.mjs: an argument dropped,
//     the text cut short, tokens swapped, put in, taken out), on every dialect; each of those that
//     still compiles has a well-formed plan (src/check.js);
//   - a query that is not a text; a number past a double's range;
//   - the functions Substrait has nothing for, refused by name; those it has, compiled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCompiler, DaxError } from '../src/index.js';
import { tmslToModel } from '../formats/tmsl.js';
import { SCALAR, TABLE, MODIFIERS, minArgs } from '../src/functions/index.js';
import { checkPlan } from '../src/check.js';
import { loadQueries, readBim } from '../conformance/tools/suite.mjs';
import { mutations } from '../conformance/tools/mutate.mjs';
import { bim } from './fixtures/contoso.js';

const DIALECTS = ['duckdb', 'tsql', 'postgres', 'polars', 'datafusion'];
const compilers = Object.fromEntries(DIALECTS.map(d => [d, createCompiler(tmslToModel(bim), { dialect: d })]));
// What a text compiles to: 'sql', a DaxError's code, or the exception that is neither.
const outcome = (c, q) => {
  try { c.compile(q); return 'sql'; } catch (e) { return e instanceof DaxError ? e.code : e; }
};
const raw = (c, qs) => qs.map(q => [q, outcome(c, q)]).filter(([, o]) => typeof o !== 'string').map(([q, e]) => `${q}: ${e.constructor.name}: ${e.message.split('\n')[0]}`);

const KINDS = ['Sales[Qty]', '1', '"a"', 'Product', 'TRUE()', 'DATE(2024, 1, 1)', '[Sales Amount]', 'BLANK()', 'Sales[ShipDate]', 'Both'];
const callsOf = (name, wrap) => {
  const out = [wrap(`${name}()`)];
  for (let k = 1; k <= 4; k++) for (let i = 0; i < KINDS.length; i++) out.push(wrap(`${name}(${Array.from({ length: k }, (_, j) => KINDS[(i + j) % KINDS.length]).join(', ')})`));
  return out;
};
const CALLS = [
  ...[...SCALAR.keys()].flatMap(n => callsOf(n, x => `EVALUATE ROW("x", ${x})`)),
  ...[...TABLE.keys()].flatMap(n => callsOf(n, x => `EVALUATE ${x}`)),
  ...[...MODIFIERS.keys()].flatMap(n => callsOf(n, x => `EVALUATE ROW("x", CALCULATE([Sales Amount], ${x}))`)),
];

for (const d of DIALECTS) {
  test(`${d}: every function and modifier, with 0 to 4 arguments of each kind, is SQL or a DaxError`, () => {
    assert.deepEqual(raw(compilers[d], CALLS), []);
  });
}

test('too few arguments: DAX\'s error, naming the function and how many it takes', () => {
  const c = compilers.duckdb;
  for (const [q, fn, n] of [['EVALUATE ROW("x", IF(1))', 'IF', 2], ['EVALUATE ROW("x", ABS())', 'ABS', 1], ['EVALUATE ROW("x", DATE(2024, 1))', 'DATE', 3],
    ['EVALUATE FILTER(Product)', 'FILTER', 2], ['EVALUATE ROW("x", SUMX(Sales))', 'SUMX', 2], ['EVALUATE ROW()', 'ROW', 1],
    ['EVALUATE ROW("x", CALCULATE([Sales Amount], USERELATIONSHIP(Sales[ShipDate])))', 'USERELATIONSHIP', 2]]) {
    assert.throws(() => c.compile(q), e => e instanceof DaxError && e.code === 'SEMANTIC'
      && e.message === `DAX: Too few arguments were passed to the ${fn} function. The minimum argument count for the function is ${n}.`, q);
  }
  // As many as the fewest each takes is never refused for their number.
  for (const name of [...SCALAR.keys(), ...TABLE.keys()]) {
    const n = minArgs(name);
    if (!n) continue;
    const q = `EVALUATE ROW("x", ${name}(${Array(n).fill('1').join(', ')}))`;
    try { compilers.duckdb.compile(q); } catch (e) { assert.doesNotMatch(e.message, /Too few arguments/, q); }
  }
});

test('the suite\'s queries broken on purpose: SQL or a DaxError on every dialect, a well-formed plan where SQL', () => {
  const qs = loadQueries({ model: 'contoso' }).filter(q => !q.roles).map(q => q.dax.split('\n').filter(l => !l.startsWith('//')).join('\n'));
  const cs = Object.fromEntries(DIALECTS.map(d => [d, createCompiler(tmslToModel(readBim('contoso')), { dialect: d })]));
  const bad = [];
  let compiled = 0;
  for (const m of mutations(qs, 1500, 20261125)) {
    for (const d of DIALECTS) {
      const o = outcome(cs[d], m.dax);
      if (typeof o !== 'string') bad.push(`${d}, ${m.how}: ${o.constructor.name}: ${o.message.split('\n')[0]}\n  ${m.dax}`);
      else if (o === 'sql' && d === 'duckdb') {
        compiled++;
        for (const p of [{ correlated: true }, { unnest: true }, {}]) {
          try { checkPlan(cs.duckdb.plan(m.dax, p), { stage: JSON.stringify(p), final: true }); } catch (e) { bad.push(`${e.message}\n  ${m.dax}`); }
        }
      }
    }
  }
  assert.deepEqual(bad, []);
  assert.ok(compiled > 60, `only ${compiled} of the broken queries compile: the check of their plans checks little`);
});

test('a calculation group over a value of two kinds compiles on every dialect, in moments (passes/outer.js read its condition through every projection: it doubled each time, past the memory there is)', () => {
  const c = Object.fromEntries(DIALECTS.map(d => [d, createCompiler(tmslToModel(readBim('contoso')), { dialect: d })]));
  for (const d of DIALECTS) {
    const t0 = Date.now();
    assert.equal(outcome(c[d], 'EVALUATE SUMMARIZECOLUMNS(\'Time Calc\'[Time Calc], "m0", IF(1 > 0, [All Sales], TRUE()))'), 'sql', d);
    assert.ok(Date.now() - t0 < 5000, `${d}: ${Date.now() - t0} ms`);
  }
});

test('a query that is not a text: SYNTAX', () => {
  for (const q of [null, undefined, 42, true]) {
    for (const f of ['compile', 'compileAll', 'plan', 'explain', 'compileStatement']) {
      assert.throws(() => compilers.duckdb[f](q), e => e instanceof DaxError && e.code === 'SYNTAX', `${f}(${q})`);
    }
  }
});

test('a number past a double\'s range is DAX\'s error (Power BI\'s: out of range), not a blank', () => {
  for (const d of DIALECTS) for (const n of ['1E400', '-1E400']) assert.equal(outcome(compilers[d], `EVALUATE ROW("x", ${n})`), 'SEMANTIC', `${d} ${n}`);
});

test('what Substrait has nothing for is refused by name; what it has compiles, on every dialect', () => {
  for (const f of ['RAND()', 'RANDBETWEEN(1, 5)', 'GCD(4, 6)', 'LCM(4, 6)', 'UNICHAR(65)']) {
    for (const d of DIALECTS) {
      assert.throws(() => compilers[d].compile(`EVALUATE ROW("x", ${f})`), e => e.code === 'UNSUPPORTED' && e.message.includes(f.split('(')[0]), `${d} ${f}`);
    }
  }
  for (const f of ['TODAY()', 'NOW()', 'UTCTODAY()', 'UTCNOW()', 'REPT("a", 3)', 'EVEN(3)', 'ODD(2)', 'WEEKNUM(DATE(2024, 3, 1), 21)', 'REPLACE("abc", 1, 1, "x")', 'ERROR("x")']) {
    for (const d of DIALECTS) assert.equal(outcome(compilers[d], `EVALUATE ROW("x", ${f})`), 'sql', `${d} ${f}`);
  }
  assert.equal(outcome(compilers.duckdb, 'EVALUATE ROW("x", FACT(4))'), 'sql');
  assert.equal(outcome(compilers.duckdb, 'EVALUATE ROW("x", AND(1, "a"))'), 'SEMANTIC');
});
