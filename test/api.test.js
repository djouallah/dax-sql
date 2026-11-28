// The public API's contract (DESIGN.md, Contract), as its two clients use it: what a call takes
// and gives, and nothing of how the SQL is written. A test here fails only when the contract
// changes; the SQL, the plan and the passes may change in any commit.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createCompiler, createViews, DaxError, DuckDBDialect } from '../src/index.js';
import { tmslToModel } from '../formats/tmsl.js';
import { harness } from './helpers.js';
import { bim, setup } from './fixtures/contoso.js';

let h;
before(async () => { h = await harness(bim, setup); });
const model = () => tmslToModel(bim);
const Q = 'EVALUATE SUMMARIZECOLUMNS(Product[Color], "s", [Sales Amount], "o", [Orders])';
const inputError = f => assert.throws(f, e => e instanceof DaxError && e.code === 'INPUT');

test('createCompiler takes its documented options and refuses any other, or a value of the wrong kind', () => {
  createCompiler(model(), {
    tableSource: t => `"${t.name}"`, dialect: 'duckdb', columnNames: 'dax', castOutput: { int: s => s }, assumeIntegrity: false,
    trailingSpaces: () => undefined, orphans: () => undefined, user: 'me', roles: [], params: { p: 1 },
  });
  createCompiler(model(), { dialect: new DuckDBDialect(), castOutput: false, roles: 'Paris', tableSource: undefined });
  for (const o of [{ blankRows: false }, { aliasStart: 3 }, { security: [] }, { orphan: () => 1 }]) inputError(() => createCompiler(model(), o));
  for (const o of [{ orphans: true }, { dialect: 'postgres' }, { columnNames: 'long' }, { castOutput: 'yes' }, { roles: [1] }, { user: 1 }])
    inputError(() => createCompiler(model(), o));
  inputError(() => createCompiler(model(), []));
});

test('the methods\' options and the views\' are checked the same way', () => {
  const c = createCompiler(model());
  for (const o of [{ optimize: false }, { correlated: true }, { unnest: true }]) c.plan(Q, o);
  c.substrait(Q, { correlated: true, inline: true });
  for (const f of [() => c.plan(Q, { optimise: false }), () => c.explain(Q, { correlated: 'yes' }), () => c.planSql(Q, { inline: true }), () => c.substrait(Q, { x: 1 })]) inputError(f);
  const v = createViews({ fullNames: true, dialect: 'duckdb' });
  assert.equal(v.define('m', model(), { path: 'm.bim', db: 'memory', schema: 'main', mode: 'replace', tablesFrom: 'search path', orphans: () => undefined }), 'created');
  // null is no value (OneLake Studio's tablesFrom when its model reads no lakehouse): kept as it is.
  v.define('k', model(), { mode: 'replace', tablesFrom: null, tableSource: undefined });
  assert.equal(v.get('k').tablesFrom, null);
  inputError(() => createViews({ fullName: true }));
  inputError(() => v.define('n', model(), { mode: 'upsert' }));
  inputError(() => v.define('n', model(), { blankRows: false }));
  inputError(() => v.drop('m', { if_exists: true }));
  assert.equal(v.drop('nothing', { ifExists: true }), false);
});

test('compile gives { sql, columns } with the contract\'s type names; the SQL is one SELECT, the same each time', async () => {
  const types = new Set(['int', 'double', 'decimal', 'string', 'datetime', 'bool', 'variant', 'blank']);
  const a = createCompiler(model()).compile(Q), b = createCompiler(model()).compile(Q);
  assert.equal(a.sql, b.sql, 'deterministic');
  assert.ok(!/;\s*$/.test(a.sql));
  assert.deepEqual(a.columns.map(c => c.name), ['Color', 's', 'o']);
  for (const c of a.columns) assert.ok(types.has(c.type), c.type);
  // It runs as a subquery and under EXPLAIN.
  assert.equal((await h.sql(`SELECT COUNT(*) AS n FROM (\n${h.dax.compile(Q).sql}\n)`))[0].n > 0, true);
  await h.sql(`EXPLAIN ${h.dax.compile(Q).sql}`);
  assert.equal(h.dax.isDax(Q), true);
  assert.equal(h.dax.isDax('SELECT 1'), false);
  const s = h.dax.compileStatement('SELECT n FROM (SELECT Color, AGG(Orders) AS n FROM model GROUP BY ALL)');
  assert.equal(typeof s.sql, 'string');
  assert.ok(Array.isArray(s.relations));
});

test('every built-in dialect compiles to one SELECT with the same columns', () => {
  const duck = createCompiler(model()).compile(Q).columns.map(c => [c.name, c.type]);
  for (const dialect of ['duckdb', 'tsql', 'polars', 'datafusion']) {
    const { sql, columns } = createCompiler(model(), { dialect }).compile(Q);
    assert.equal(typeof sql, 'string', dialect);
    assert.deepEqual(columns.map(c => [c.name, c.type]), duck, dialect);
  }
});

test('orphanCheck and trailingSpacesCheck: one row, one boolean per entry, in its order', async () => {
  const o = h.dax.orphanCheck();
  assert.ok(o.rels.length > 0);
  for (const r of o.rels) { assert.equal(typeof r.key, 'string'); assert.equal(typeof r.many.table, 'string'); assert.equal(typeof r.one.table, 'string'); }
  const [row] = await h.sql(o.sql);
  assert.equal(Object.values(row).length, o.rels.length);
  for (const x of Object.values(row)) assert.equal(typeof x, 'boolean');
  const t = h.dax.trailingSpacesCheck();
  for (const c of t.columns) { assert.equal(typeof c.key, 'string'); assert.equal(typeof c.table, 'string'); }
  const [row2] = await h.sql(t.sql);
  assert.equal(Object.values(row2).length, t.columns.length);
  for (const x of Object.values(row2)) assert.equal(typeof x, 'boolean');
});

test('the option callbacks receive what the contract says', () => {
  const seen = { tables: [], rels: [], cols: [] };
  const c = createCompiler(model(), {
    tableSource: t => { seen.tables.push(t); return `"${t.name}"`; },
    orphans: r => { seen.rels.push(r); return undefined; },
    trailingSpaces: col => { seen.cols.push(col); return undefined; },
  });
  // (The second asks whether Product has its blank row: orphans is asked of its relationships.)
  for (const q of [Q, 'EVALUATE ROW("n", COUNTROWS(VALUES(Product[Color])))']) c.compile(q);
  for (const t of seen.tables) assert.equal(typeof t.name, 'string');
  for (const r of seen.rels) for (const k of ['key', 'name']) assert.equal(typeof r[k], 'string');
  for (const r of seen.rels) for (const s of ['many', 'one']) { assert.equal(typeof r[s].table, 'string'); assert.equal(typeof r[s].column, 'string'); }
  for (const c of seen.cols) for (const k of ['key', 'table', 'column']) assert.equal(typeof c[k], 'string');
  assert.ok(seen.tables.length && seen.rels.length && seen.cols.length);
});

test('describe() and dimensionsOf(): the model as a host lists it', () => {
  const c = createCompiler(model());
  const d = c.describe();
  const sales = d.tables.find(t => t.name === 'Sales');
  assert.equal(typeof sales.hidden, 'boolean');
  for (const col of sales.columns) {
    assert.deepEqual(Object.keys(col).sort(), ['calculated', 'expression', 'name', 'nullable', 'type', 'unique']);
  }
  const m = d.measures.find(x => x.name === 'Sales Amount');
  assert.deepEqual(m, { name: 'Sales Amount', table: 'Sales', expression: 'SUM(Sales[Amount])', formatString: null, type: 'decimal' });
  // A measure's type is compile's for it alone.
  for (const x of d.measures) assert.equal(x.type, (() => { try { return c.compile(`EVALUATE ROW("v", [${x.name}])`).columns[0].type; } catch { return 'variant'; } })(), x.name);
  const dims = c.dimensionsOf('Sales Amount').map(t => t.name);
  assert.ok(dims.includes('Product') && dims.includes('Sales'), dims.join());
  assert.throws(() => c.dimensionsOf('No Such Measure'), e => e.code === 'SEMANTIC');
});

test('the files a client loads are static ESM with relative imports only (QuickJS and the browser)', () => {
  const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : []; });
  const files = [...walk(join(root, 'src')), ...['tmsl', 'tmdl', 'ossie', 'ossie-sql'].map(f => join(root, 'formats', `${f}.js`))];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const [, spec] of text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"\n;]*?from\s*['"]([^'"]+)['"]/g)) assert.match(spec, /^\.\.?\//, `${f}: ${spec}`);
    assert.doesNotMatch(text, /\bimport\s*\(/, `${f}: a dynamic import`);
    assert.doesNotMatch(text, /\brequire\s*\(/, `${f}: require`);
  }
});
