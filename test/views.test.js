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
    [{ create: { db: null, schema: 's', name: 'sales', path: 'a/b.bim', mode: 'replace', exists: false } }]);
  assert.deepEqual(views.rewrite(`create semantic view if not exists sales from 'b.bim';`),
    [{ create: { db: null, schema: null, name: 'sales', path: 'b.bim', mode: 'if_not_exists', exists: false } }]);
  assert.deepEqual(views.rewrite('DROP SEMANTIC VIEW IF EXISTS nothing'), [{ drop: { name: 'nothing', ifExists: true, exists: false } }]);
  // The host carries a view statement out, and says whether a missing or present view is an error (#36).
  assert.equal(views.rewrite(`CREATE SEMANTIC VIEW contoso FROM 'x.bim'`)[0].create.exists, true);
  assert.deepEqual(views.rewrite('DROP SEMANTIC VIEW nothing'), [{ drop: { name: 'nothing', ifExists: false, exists: false } }]);
  assert.throws(() => views.drop('nothing'), e => e.code === 'CATALOG' && /does not exist/.test(e.message));
  // OR REPLACE and IF NOT EXISTS say opposite things (#34).
  assert.throws(() => views.rewrite(`CREATE OR REPLACE SEMANTIC VIEW IF NOT EXISTS v FROM 'x.bim'`), e => e.code === 'SYNTAX' && /cannot be combined with IF NOT EXISTS/.test(e.message));
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

// Two models of one name in two workspaces are two views: each named in full as ws.model, and
// by its name alone only while that name is the one view's.
test('views of one name in two schemas: named in full, or in part while that is unique', async () => {
  const two = createViews();
  two.define('contoso', tmslToModel(bim), { schema: 'prod', path: 'p.bim' });
  assert.equal(two.get('contoso').sqlName, 'prod.contoso');
  const alone = await (async () => { const [{ sql }] = two.rewrite('SELECT Color, AGG(Orders) AS o FROM contoso GROUP BY ALL'); return h.sql(sql); })();
  two.define('contoso', tmslToModel(bim), { schema: 'Test WS', path: 't.bim' });
  assert.equal(two.list().length, 2);
  assert.equal(two.get('"Test WS".contoso').sqlName, '"Test WS".contoso');
  // In full, quoted or not, in any case; and in a subquery.
  for (const text of ['SELECT Color, AGG(Orders) AS o FROM prod.contoso GROUP BY ALL',
                      'SELECT Color, AGG(Orders) AS o FROM PROD.Contoso GROUP BY ALL',
                      'SELECT * FROM (SELECT Color, AGG(Orders) AS o FROM "Test WS".contoso GROUP BY ALL) t']) {
    const [{ sql }] = two.rewrite(text);
    assert.deepEqual(sorted((await h.sql(sql)).map(r => [r.Color, r.o])), sorted(alone.map(r => [r.Color, r.o])), text);
  }
  // In part, now that it fits two: an error naming both.
  assert.throws(() => two.rewrite('SELECT Color FROM contoso GROUP BY ALL'),
    e => e.code === 'CATALOG' && /ambiguous/.test(e.message) && /prod\.contoso/.test(e.message) && /"Test WS"\.contoso/.test(e.message));
  // SHOW / DESCRIBE / DROP by the full name.
  assert.ok((await h.sql(two.rewrite('SHOW SEMANTIC METRICS IN prod.contoso')[0].sql)).length > 0);
  assert.deepEqual(two.rewrite('DROP SEMANTIC VIEW prod.contoso'), [{ drop: { name: 'prod.contoso', ifExists: false, exists: true } }]);
  assert.equal(two.drop('prod.contoso'), true);
  assert.equal(two.get('contoso').sqlName, '"Test WS".contoso', 'the other is the only contoso now');
  // CREATE in a schema reports it, and one of that full name exists already.
  assert.equal(two.rewrite(`CREATE SEMANTIC VIEW "Test WS".contoso FROM 'x.bim'`)[0].create.exists, true);
});

test('fullNames: a statement reaches a view by its whole name and no other', async () => {
  const strict = createViews({ fullNames: true });
  strict.define('contoso', tmslToModel(bim), { db: 'semanticmodel', schema: 'prod', path: 'p.bim' });
  const query = name => `SELECT Color, AGG(Orders) AS o FROM ${name} GROUP BY ALL`;
  for (const name of ['semanticmodel.prod.contoso', 'SemanticModel.PROD.Contoso']) {
    const [{ sql }] = strict.rewrite(query(name));
    assert.ok((await h.sql(sql)).length > 0, name);
  }
  // Shorter is not this view's: nothing compiled, and left for the engine to answer.
  for (const name of ['contoso', 'prod.contoso', 'other.prod.contoso']) {
    assert.equal(strict.rewrite(query(name)), null, name);
    assert.equal(strict.rewrite(`DESCRIBE ${name}`), null, name);
    assert.throws(() => strict.rewrite(`SHOW SEMANTIC METRICS IN ${name}`), /does not exist/, name);
  }
  assert.ok((await h.sql(strict.rewrite('SHOW SEMANTIC METRICS IN semanticmodel.prod.contoso')[0].sql)).length > 0);
  // Two of a name are no longer ambiguous: neither is reached by it.
  strict.define('contoso', tmslToModel(bim), { db: 'semanticmodel', schema: 'dev', path: 'd.bim' });
  assert.equal(strict.rewrite(query('contoso')), null);
  // The host's own calls still take a part of the name.
  assert.equal(strict.get('prod.contoso').sqlName, 'prod.contoso');
});

test('compileStatement takes a qualified model name, as text or as parts', () => {
  const c = views.get('contoso').compiler;
  const text = 'SELECT Color, AGG(Orders) AS o FROM ws.contoso GROUP BY ALL';
  assert.equal(c.compileStatement(text, 'ws.contoso').sql, c.compileStatement(text, ['ws', 'contoso']).sql);
  assert.notEqual(c.compileStatement(text, 'ws.contoso').sql, text);
  // Only the whole name is the model: a longer or shorter one is not.
  assert.equal(c.compileStatement('SELECT 1 FROM x.ws.contoso', 'ws.contoso').sql, 'SELECT 1 FROM x.ws.contoso');
});

test("two views in one statement: one's SQL is not read again for the other's name (a view named like a table it reads)", async () => {
  const v2 = createViews();
  v2.define('contoso', tmslToModel(bim));
  // A view named Sales, over a model of Category alone: contoso's SQL reads "Sales".
  const cats = { model: { tables: [{ name: 'Category', columns: [{ name: 'Category', dataType: 'string', sourceColumn: 'Category' }],
    measures: [{ name: 'Cats', expression: 'COUNTROWS(Category)' }], partitions: [{ name: 'p', source: { type: 'entity', entityName: 'Category' } }] }] } };
  v2.define('Sales', tmslToModel(cats));
  const [{ sql }] = v2.rewrite('SELECT a.Color, a.o, b.n FROM (SELECT Color, AGG(Orders) AS o FROM contoso GROUP BY ALL) AS a CROSS JOIN (SELECT AGG(Cats) AS n FROM Sales) AS b');
  const rows = await h.sql(sql);
  const direct = await h.run('EVALUATE SUMMARIZECOLUMNS(Product[Color], "o", [Orders], "n", COUNTROWS(ALL(Category)))');
  assert.deepEqual(sorted(rows.map(r => [r.Color, r.o, r.n])), sorted(direct.map(r => [r.Color, r.o, r.n])));
});

// The DuckDB extension's needs of the views (#16-#19), and names with the schema main written.
test('a host\'s own SHOW SEMANTIC VIEWS columns, given at define and annotated after (#16)', async () => {
  const v = createViews({ viewColumns: [['data_as_of', 'VARCHAR'], ['pinned', 'BIGINT']] });
  v.define('contoso', tmslToModel(bim), { path: 'c.bim', columns: { data_as_of: 'current data' } });
  v.annotate('contoso', { pinned: 15 });
  const [{ sql }] = v.rewrite('SHOW SEMANTIC VIEWS');
  assert.deepEqual(await h.sql(sql), [{ database_name: 'memory', schema_name: 'main', view_name: 'contoso', path: 'c.bim', tables_from: 'search path', data_as_of: 'current data', pinned: 15 }]);
  const [nested] = v.rewrite('SELECT data_as_of, pinned FROM (SHOW SEMANTIC VIEWS)');
  assert.deepEqual(await h.sql(nested.sql), [{ data_as_of: 'current data', pinned: 15 }]);
  v.annotate('contoso', { data_as_of: null });
  assert.deepEqual((await h.sql(v.rewrite('SELECT data_as_of FROM (SHOW SEMANTIC VIEWS)')[0].sql))[0], { data_as_of: null });
  assert.throws(() => v.annotate('contoso', { other: 1 }), e => e.code === 'INPUT');
  assert.throws(() => v.define('x', tmslToModel(bim), { columns: { data_as_of: {} } }), e => e.code === 'INPUT');
});

test('DESCRIBE | DESC SEMANTIC VIEW v, as DESCRIBE v, and an error for none (#17)', async () => {
  const want = await run('DESCRIBE contoso');
  for (const s of ['DESCRIBE SEMANTIC VIEW contoso', 'DESC SEMANTIC VIEW memory.main.contoso']) assert.deepEqual(await run(s), want, s);
  assert.deepEqual(await run('SELECT * FROM (DESC SEMANTIC VIEW main.contoso)'), want);
  assert.throws(() => views.rewrite('DESCRIBE SEMANTIC VIEW nothing_here'), e => e.code === 'CATALOG' && /semantic view nothing_here does not exist/.test(e.message));
});

test('a view kept with its error when its model does not read (restore, #18)', () => {
  const v = createViews();
  assert.equal(v.define('nem', null, { path: 'nem.yaml', mode: 'restore', error: 'it has no datasets' }), 'created');
  assert.equal(v.define('bad', 'not a model', { path: 'bad.bim', mode: 'restore' }), 'created', 'a model that does not read');
  assert.match(v.rewrite('SHOW SEMANTIC VIEWS')[0].sql, /'nem', 'nem\.yaml'/);
  for (const s of ['SELECT AGG(Orders) FROM nem', 'SHOW SEMANTIC METRICS IN nem', 'SHOW SEMANTIC DIMENSIONS IN nem', 'DESCRIBE nem', 'DESCRIBE SEMANTIC VIEW nem']) {
    assert.throws(() => v.rewrite(s), e => e.code === 'INPUT' && /^semantic view nem: it has no datasets$/.test(e.message), s);
  }
  assert.throws(() => v.rewrite('SELECT * FROM bad'), e => e.code === 'INPUT' && /^semantic view bad: /.test(e.message));
  // Replaced, or dropped, as any view.
  assert.equal(v.define('nem', tmslToModel(bim), { mode: 'replace' }), 'created');
  assert.ok(v.rewrite('SHOW SEMANTIC METRICS IN nem')[0].sql);
  assert.equal(v.drop('bad'), true);
  assert.throws(() => v.define('x', null, { error: 'why' }), e => e.code === 'INPUT', 'error is for restore');
});

test('REFRESH SEMANTIC VIEW v: an entry for the host, the name in full (#19)', () => {
  const v = createViews();
  v.define('contoso', tmslToModel(bim), { schema: 'sales' });
  assert.deepEqual(v.rewrite('REFRESH SEMANTIC VIEW memory.sales.contoso'), [{ refresh: { name: 'sales.contoso', exists: true } }]);
  assert.deepEqual(v.rewrite('REFRESH SEMANTIC VIEW contoso'), [{ refresh: { name: 'sales.contoso', exists: true } }]);
  assert.deepEqual(v.rewrite('REFRESH SEMANTIC VIEW nope'), [{ refresh: { name: 'nope', exists: false } }]);
});

test('a view of the schema main is reached with main written too: main.v, db.main.v', async () => {
  const want = await run('SHOW SEMANTIC METRICS IN contoso');
  for (const n of ['main.contoso', 'memory.main.contoso', 'memory.contoso']) assert.deepEqual(await run(`SHOW SEMANTIC METRICS IN ${n}`), want, n);
  const full = createViews({ fullNames: true });
  full.define('contoso', tmslToModel(bim));
  assert.ok(full.rewrite('SHOW SEMANTIC METRICS IN memory.main.contoso')[0].sql);
  assert.ok(full.rewrite('SHOW SEMANTIC METRICS IN memory.contoso')[0].sql);
});

// A host that defines views when a statement names one (#21): the names, from rewrite's own
// tokenizer; and under fullNames, a default db for a name of one part fewer.
test('names(sql, { match }): the names a statement reads views by, defined or not; db for 2-part names (#21)', () => {
  const v = createViews({ fullNames: true, db: 'onelake' });
  v.define('sales_semanticmodel', tmslToModel(bim), { schema: 'ws' });
  assert.equal(v.list()[0].db, 'onelake', 'define reads db as the default');
  const sql = `-- FROM commented.out_semanticmodel
SELECT * FROM ws.sales_semanticmodel s JOIN "my ws"."Other_SemanticModel" o ON 1 = 1
WHERE x = 'FROM str.in_semanticmodel' AND y IN (SELECT 1 FROM t);
SHOW SEMANTIC METRICS IN ws.third_semanticmodel; DESC SEMANTIC VIEW onelake.ws.sales_semanticmodel;
REFRESH SEMANTIC VIEW ws.fourth_semanticmodel; SELECT * FROM (DESCRIBE x.fifth_semanticmodel)`;
  const ours = p => /_semanticmodel$/i.test(p.at(-1));
  assert.deepEqual(v.names(sql, { match: ours }), [
    { parts: ['ws', 'sales_semanticmodel'], view: true },
    { parts: ['my ws', 'Other_SemanticModel'], view: false },
    { parts: ['ws', 'third_semanticmodel'], view: false },
    { parts: ['onelake', 'ws', 'sales_semanticmodel'], view: true },
    { parts: ['ws', 'fourth_semanticmodel'], view: false },
    { parts: ['x', 'fifth_semanticmodel'], view: false },
  ]);
  assert.ok(v.names(sql).some(n => n.parts.join('.') === 't'), 'without match, every relation');
  // ws.model is read in db onelake: no host rewrite of the text first.
  assert.ok(v.rewrite('SELECT AGG(Orders) FROM ws.sales_semanticmodel')[0].sql);
  assert.throws(() => v.names(sql, { match: 1 }), e => e.code === 'INPUT' && /match is a function/.test(e.message));
});

// A model query under SUMMARIZE (or DESCRIBE) in parentheses (#38): DuckDB's Python
// client shows a relation as SELECT * FROM (<its text>).
test('(SUMMARIZE | DESCRIBE <model query>) inside parentheses: the query compiled, the word kept', async () => {
  const q = 'SELECT Product.Color, AGG(Orders) AS orders FROM contoso GROUP BY ALL ORDER BY Color';
  const top = await run(`SUMMARIZE ${q}`);
  const wrapped = await run(`SELECT * FROM (\nSUMMARIZE ${q}\n) AS "unnamed_relation_1"`);
  assert.deepEqual(wrapped, top);
  assert.deepEqual(top.map(r => r.column_name), ['Color', 'orders']);
  const described = await run(`SELECT column_name FROM (DESCRIBE ${q}) AS d`);
  assert.deepEqual(described.map(r => r.column_name), ['Color', 'orders']);
  // (EXPLAIN is no subquery in DuckDB at all.)
});
