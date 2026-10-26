// Semantic views (src/views.js): the statements that make, drop and list them, each answer run
// on DuckDB over the contoso fixture.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { harness, sorted } from './helpers.js';
import { bim, setup } from './fixtures/contoso.js';
import { createViews, DaxError } from '../src/index.js';
import { tmslToModel } from '../formats/tmsl.js';

let h, views;
before(async () => {
  h = await harness(bim, setup);
  views = createViews();
  assert.equal(views.define('contoso', tmslToModel(bim), { path: 'contoso/model.bim' }), 'created');
});

// The one statement a text holds, run.
async function run(text) {
  const out = views.rewrite(text);
  assert.ok(out && out.length === 1 && out[0].sql, `${text} is one query`);
  return h.sql(out[0].sql);
}

test('defining: a name once, unless replaced', () => {
  assert.throws(() => views.define('Contoso', tmslToModel(bim)), e => e instanceof DaxError && e.code === 'CATALOG' && /already exists/.test(e.message));
  assert.equal(views.define('contoso', tmslToModel(bim), { path: 'contoso/model.bim', mode: 'if_not_exists' }), 'exists');
  assert.equal(views.define('contoso', tmslToModel(bim), { path: 'contoso/model.bim', mode: 'replace' }), 'created');
  assert.equal(views.list().length, 1);
});

test('CREATE and DROP are reported to the host, which stores the view', () => {
  assert.deepEqual(views.rewrite(`CREATE OR REPLACE SEMANTIC VIEW s.sales FROM 'a/b.bim'`),
    [{ create: { db: null, schema: 's', name: 'sales', path: 'a/b.bim', mode: 'replace' } }]);
  assert.deepEqual(views.rewrite(`create semantic view if not exists sales from 'b.bim';`),
    [{ create: { db: null, schema: null, name: 'sales', path: 'b.bim', mode: 'if_not_exists' } }]);
  assert.deepEqual(views.rewrite('DROP SEMANTIC VIEW IF EXISTS nothing'), [{ drop: { name: 'nothing', ifExists: true } }]);
  assert.throws(() => views.rewrite(`CREATE SEMANTIC VIEW contoso FROM 'x.bim'`), /semantic view contoso already exists/);
  assert.throws(() => views.rewrite('DROP SEMANTIC VIEW nothing'), /semantic view nothing does not exist/);
  assert.throws(() => views.rewrite('CREATE SEMANTIC VIEW x FROM model.bim'), /expected a quoted path/);
  assert.throws(() => views.rewrite(`CREATE SEMANTIC VIEW x FROM 'a.bim' AND MORE`), /syntax error at or near "AND"/);
});

test('drop forgets a view', () => {
  const v = createViews();
  v.define('a', tmslToModel(bim));
  assert.equal(v.drop('A'), true);
  assert.equal(v.drop('a', { ifExists: true }), false);
  assert.throws(() => v.drop('a'), /does not exist/);
});

test('SHOW SEMANTIC VIEWS', async () => {
  assert.deepEqual(await run('SHOW SEMANTIC VIEWS'),
    [{ database_name: 'memory', schema_name: 'main', view_name: 'contoso', path: 'contoso/model.bim', tables_from: 'search path' }]);
});

test('SHOW SEMANTIC METRICS: every measure, with its DAX and its type', async () => {
  const rows = await run('SHOW SEMANTIC METRICS IN contoso');
  assert.deepEqual(Object.keys(rows[0]), ['database_name', 'schema_name', 'view_name', 'table_name', 'name', 'data_type',
    'expression', 'format_string', 'hidden', 'comment']);
  const orders = rows.find(r => r.name === 'Orders');
  assert.ok(orders, 'Orders is listed');
  assert.equal(orders.data_type, 'BIGINT');
  assert.ok(orders.expression, 'with its DAX');
  assert.equal(rows.length, tmslToModel(bim).tables.flatMap(t => t.measures ?? []).length);
});

test('SHOW SEMANTIC DIMENSIONS, and FOR METRIC: only what filters it', async () => {
  const all = await run('SHOW SEMANTIC DIMENSIONS IN contoso');
  const forOrders = await run('SHOW SEMANTIC DIMENSIONS IN contoso FOR METRIC Orders');
  assert.ok(forOrders.length > 0 && forOrders.length <= all.length);
  const reached = new Set(forOrders.map(r => r.table_name));
  assert.ok(reached.has('Product'), 'Sales reaches Product');
  assert.throws(() => views.rewrite('SHOW SEMANTIC DIMENSIONS IN contoso FOR METRIC Nope'), /has no metric Nope/);
});

test('DESCRIBE a view: its columns and its measures, as DESCRIBE lists a table', async () => {
  const rows = await run('DESCRIBE contoso');
  assert.deepEqual(Object.keys(rows[0]), ['column_name', 'column_type', 'null', 'key', 'default', 'extra']);
  assert.ok(rows.some(r => r.column_name === 'Product.Color' && r.extra === 'column'));
  assert.ok(rows.some(r => r.column_name === 'Orders' && r.extra === 'measure'));
  assert.equal(views.rewrite('DESCRIBE some_table'), null, 'any other DESCRIBE is the engine\'s');
});

test('the inspecting statements read as subqueries', async () => {
  const rows = await run(`SELECT name, data_type FROM (SHOW SEMANTIC METRICS IN contoso) WHERE name = 'Orders'`);
  assert.deepEqual(rows, [{ name: 'Orders', data_type: 'BIGINT' }]);
  const cols = await run(`SELECT count(*) AS n FROM (DESCRIBE contoso) WHERE extra = 'column'`);
  assert.ok(cols[0].n > 0);
});

test('a model query is compiled as compileStatement compiles it', async () => {
  const text = 'SELECT Color, AGG(Orders) AS o FROM contoso GROUP BY ALL';
  const [{ sql }] = views.rewrite(text);
  assert.equal(sql, views.get('contoso').compiler.compileStatement(text, 'contoso').sql);
  const direct = await h.run('EVALUATE SUMMARIZECOLUMNS(Product[Color], "o", [Orders])');
  assert.deepEqual(sorted((await h.sql(sql)).map(r => [r.Color, r.o])), sorted(direct.map(r => [r.Color, r.o])));
});

test('a text naming no view is left alone, statement by statement', () => {
  assert.equal(views.rewrite('SELECT 1; SELECT 2'), null);
  const out = views.rewrite(`SELECT 1; SHOW SEMANTIC VIEWS`);
  assert.equal(out.length, 2);
  assert.equal(out[0].sql, 'SELECT 1');
});
