// SQL over a model's datasets (Apache Ossie's Relational Query Interface) follows SQL's rules,
// not DAX's. Each query here is checked against plain SQL over the same tables, written by hand
// as spec Section 9 says it means. CI checks far more against Ossie's view expander
// (formats/test/ossie-expand.mjs); these are the cases it found, kept here so that `npm test`
// holds them without Python or an Ossie checkout:
//   - NOT of a comparison with NULL is not true; NULL + 1 is NULL; NULLIF; WHERE FALSE;
//   - a COUNT metric is 0 over no rows inside an expression and in HAVING, NULLIF(COUNT(..), 0)
//     is not, and an expression makes no group of its own;
//   - one LEFT JOIN many, grouped by the one side's key: the many side's measure is the group's;
//   - a self-join grouped by both sides (the joined rows' groups);
//   - a key of several columns: none of its columns is unique, so a NULL group is kept;
//   - a fixed decimal: SQL's AVG(x) and SUM(x) / 12 are not rounded; ROUND(.., 4) is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DuckDBInstance } from '@duckdb/node-api';
import { createCompiler } from '../src/index.js';
import { ossieToModel } from '../formats/ossie.js';
import { metricDax, measureSql, parseDax } from '../formats/ossie-sql.js';

const DATA = `
CREATE SCHEMA s;
CREATE TABLE s.dept (deptno INTEGER, dname VARCHAR);
INSERT INTO s.dept VALUES (10, 'ACCOUNTING'), (20, 'RESEARCH'), (30, 'SALES'), (40, 'OPERATIONS');
CREATE TABLE s.emp (empno INTEGER, ename VARCHAR, job VARCHAR, mgr INTEGER, sal DECIMAL(7, 2), comm DECIMAL(7, 2), deptno INTEGER);
INSERT INTO s.emp VALUES
  (7839, 'KING', 'PRESIDENT', NULL, 5000, NULL, 10),
  (7698, 'BLAKE', 'MANAGER', 7839, 2850, NULL, 30),
  (7782, 'CLARK', 'MANAGER', 7839, 2450, NULL, 10),
  (7499, 'ALLEN', 'SALESMAN', 7698, 1600, 300, 30),
  (7521, 'WARD', 'SALESMAN', 7698, 1250, 500, 30),
  (7844, 'TURNER', 'SALESMAN', 7698, 1500, 0, 30),
  (7369, 'SMITH', 'CLERK', 7782, 800.05, NULL, 20),
  (7934, 'MILLER', 'CLERK', 7782, 1300.03, NULL, 10);
CREATE TABLE s.visit (k1 VARCHAR, k2 INTEGER, n INTEGER);
INSERT INTO s.visit VALUES ('a', 1, 5), ('a', 2, 6), (NULL, 3, 7), (NULL, 4, 8), ('b', 5, 9);
CREATE TABLE s.ev (id INTEGER, ts TIMESTAMP, label VARCHAR, n INTEGER);
INSERT INTO s.ev VALUES (1, '2024-01-01 00:00:00', 'alpha', -7), (2, '2024-01-01 13:30:00', 'beta', 7),
  (3, '2024-01-02 09:00:00', NULL, -8), (4, '2024-01-02 23:59:00', '', NULL), (5, '2024-01-03 00:00:00', 'ab', 9);
`;

const field = (name, datatype) => ({ name, datatype, expression: { sql: name } });
const metric = (name, sql, datatype = 'Decimal') => ({ name, datatype, expression: { sql } });
const MODEL = {
  version: '0.3.0.dev0',
  name: 'm',
  datasets: [
    { name: 'dept', source: 's.dept', primary_key: ['deptno'],
      fields: [field('deptno', 'Integer'), field('dname', 'String')],
      metrics: [metric('dept_count', 'COUNT(*)', 'Integer')] },
    { name: 'emp', source: 's.emp', primary_key: ['empno'],
      fields: [field('empno', 'Integer'), field('ename', 'String'), field('job', 'String'), field('mgr', 'Integer'),
        field('sal', 'Decimal'), field('comm', 'Decimal'), field('deptno', 'Integer')],
      metrics: [
        metric('sum_sal', 'SUM(sal)'), metric('sum_comm', 'SUM(comm)'),
        metric('avg_sal', 'AVG(sal)', 'Float'), metric('sal_12', 'SUM(sal) / 12', 'Float'),
        metric('sal_12r', 'ROUND(SUM(sal) / 12, 4)'),
        metric('emp_count', 'COUNT(*)', 'Integer'), metric('comm_count', 'COUNT(comm)', 'Integer'),
        metric('comm_nz', 'NULLIF(COUNT(comm), 0)', 'Integer'),
      ] },
    { name: 'visit', source: 's.visit', primary_key: ['k1', 'k2'],
      fields: [field('k1', 'String'), field('k2', 'Integer'), field('n', 'Integer')],
      metrics: [metric('visits', 'COUNT(*)', 'Integer'), metric('total', 'SUM(n)', 'Integer')] },
    { name: 'ev', source: 's.ev', primary_key: ['id'],
      fields: [field('id', 'Integer'), field('ts', 'Timestamp'), field('label', 'String'), field('n', 'Integer')],
      metrics: [metric('events', 'COUNT(*)', 'Integer')] },
  ],
  relationships: [
    { name: 'emp_dept', from: 'emp', to: 'dept', from_columns: ['deptno'], to_columns: ['deptno'] },
  ],
};

const db = await DuckDBInstance.create(':memory:');
const con = await db.connect();
await con.run(DATA);
const dax = createCompiler(ossieToModel(MODEL));

const norm = v => (typeof v === 'bigint' ? Number(v) : v && typeof v === 'object' && 'toDouble' in v ? v.toDouble() : v);
const rowsOf = async sql => (await con.runAndReadAll(sql)).getRowsJS().map(r => r.map(norm));
const key = r => JSON.stringify(r.map(v => (typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v)));
// The query's rows are the plain SQL's, as a multiset; numbers within 1e-9.
async function same(query, reference) {
  let sql;
  try { ({ sql } = dax.compile(query)); } catch (e) { assert.fail(`${query}\n${e.message}`); }
  const [got, want] = [await rowsOf(sql), await rowsOf(reference)];
  assert.deepEqual(got.map(key).sort(), want.map(key).sort(), `${query}\n--- SQL\n${sql}`);
}

test('NOT of a comparison with NULL is not true', async () => {
  await same('SELECT AGG(emp_count) AS n FROM m.emp WHERE NOT (comm = 0)',
    'SELECT COUNT(*) FROM s.emp WHERE NOT (comm = 0)');
  await same("SELECT job, AGG(sum_sal) AS s FROM m.emp WHERE NOT (comm = 0 OR job = 'CLERK') GROUP BY job",
    "SELECT job, SUM(sal) FROM s.emp WHERE NOT (comm = 0 OR job = 'CLERK') GROUP BY job");
  await same("SELECT job, AGG(sum_sal) AS s FROM m.emp WHERE NOT (comm = 0 AND job = 'CLERK') GROUP BY job",
    "SELECT job, SUM(sal) FROM s.emp WHERE NOT (comm = 0 AND job = 'CLERK') GROUP BY job");
});

test('NULL + 1 is NULL, and so are NULL - 1 and 1 / NULL', async () => {
  await same('SELECT job, AGG(sum_comm) + 1 AS a, AGG(sum_comm) - 1 AS b, 1 / AGG(sum_comm) AS c FROM m.emp GROUP BY job',
    'SELECT job, SUM(comm) + 1, SUM(comm) - 1, 1 / SUM(comm) FROM s.emp GROUP BY job');
});

test('NULLIF, and WHERE FALSE', async () => {
  await same('SELECT job, NULLIF(AGG(comm_count), 0) AS a FROM m.emp GROUP BY job',
    'SELECT job, NULLIF(COUNT(comm), 0) FROM s.emp GROUP BY job');
  await same('SELECT AGG(emp_count) AS n, AGG(sum_sal) AS s FROM m.emp WHERE FALSE',
    'SELECT COUNT(*), SUM(sal) FROM s.emp WHERE FALSE');
  await same('SELECT job, AGG(emp_count) AS n FROM m.emp WHERE FALSE GROUP BY job',
    'SELECT job, COUNT(*) FROM s.emp WHERE FALSE GROUP BY job');
});

test('a COUNT is 0 over no rows inside an expression and in HAVING; NULLIF(COUNT(..), 0) is not', async () => {
  await same('SELECT job, AGG(comm_count) * 2 AS a, AGG(comm_count) + 1 AS b, AGG(comm_nz) AS c FROM m.emp GROUP BY job',
    'SELECT job, COUNT(comm) * 2, COUNT(comm) + 1, NULLIF(COUNT(comm), 0) FROM s.emp GROUP BY job');
  await same('SELECT job, AGG(sum_sal) AS s FROM m.emp GROUP BY job HAVING AGG(comm_count) IS NOT NULL',
    'SELECT job, SUM(sal) FROM s.emp GROUP BY job HAVING COUNT(comm) IS NOT NULL');
  await same('SELECT job, AGG(sum_sal) AS s FROM m.emp GROUP BY job HAVING AGG(comm_count) = 0',
    'SELECT job, SUM(sal) FROM s.emp GROUP BY job HAVING COUNT(comm) = 0');
  // An expression that is never NULL makes no group of its own: the groups are the rows'.
  await same('SELECT d.dname, e.job, COALESCE(AGG(e.sum_comm), 0) AS c FROM m.emp AS e JOIN m.dept AS d ON e.deptno = d.deptno GROUP BY d.dname, e.job',
    'SELECT d.dname, e.job, COALESCE(SUM(e.comm), 0) FROM s.emp AS e JOIN s.dept AS d ON e.deptno = d.deptno GROUP BY d.dname, e.job');
});

test("one LEFT JOIN many, grouped by the one side's key: the many side's measure is the group's", async () => {
  await same('SELECT d.deptno, AGG(d.dept_count) AS n, AGG(e.sum_sal) AS s FROM m.dept AS d LEFT JOIN m.emp AS e ON e.deptno = d.deptno GROUP BY d.deptno',
    'SELECT d.deptno, 1, (SELECT SUM(sal) FROM s.emp AS e WHERE e.deptno = d.deptno) FROM s.dept AS d');
});

test('a self-join grouped by both sides: each group its own rows', async () => {
  await same('SELECT o.job, f.comm, AGG(f.sum_sal) AS s FROM m.emp AS f JOIN m.emp AS o ON f.mgr = o.empno GROUP BY o.job, f.comm',
    'SELECT o.job, f.comm, SUM(f.sal) FROM s.emp AS f JOIN s.emp AS o ON f.mgr = o.empno GROUP BY o.job, f.comm');
});

test('a key of several columns: none of them unique, so the NULL group is there', async () => {
  await same('SELECT k1, AGG(total) AS t FROM m.visit GROUP BY k1 HAVING AGG(visits) IS NOT NULL',
    'SELECT k1, SUM(n) FROM s.visit GROUP BY k1');
  await same('SELECT k1, AGG(visits) AS v FROM m.visit WHERE n > 5 GROUP BY k1',
    'SELECT k1, COUNT(*) FROM s.visit WHERE n > 5 GROUP BY k1');
});

test("a fixed decimal: SQL's AVG and division are not rounded, ROUND(.., 4) is", async () => {
  await same('SELECT job, AGG(avg_sal) AS a, AGG(sal_12) AS b, AGG(sal_12r) AS c FROM m.emp GROUP BY job',
    'SELECT job, AVG(sal), SUM(sal) / 12, ROUND(SUM(sal) / 12, 4) FROM s.emp GROUP BY job');
  // Both ways: DAX rounds where its fixed decimal does, and says so in SQL; SQL's own does not.
  const ds = { name: 'T', fields: [{ name: 'x', datatype: 'Decimal' }, { name: 'n', datatype: 'Integer' }] };
  assert.equal(metricDax('AVG(x)', ds, [ds]).dax, "AVERAGEX('T', CONVERT('T'[x], DOUBLE))");
  assert.equal(metricDax('ROUND(AVG(x), 4)', ds, [ds]).dax, "AVERAGE('T'[x])");
  assert.equal(metricDax('CAST(SUM(x) AS DOUBLE) / 12', ds, [ds]).dax, "CONVERT(SUM('T'[x]), DOUBLE) / 12");
  assert.equal(metricDax('ROUND(SUM(x) / 12, 4)', ds, [ds]).dax, "SUM('T'[x]) / 12");
  const tables = new Map([['t', { name: 'T', columns: new Map([['x', { name: 'x', type: 'Decimal' }], ['n', { name: 'n', type: 'Integer' }]]) }]]);
  const sql = d => measureSql(parseDax(d), tables, new Map())?.sql;
  assert.equal(sql('AVERAGE(T[x])'), 'ROUND(AVG(x), 4)');
  assert.equal(sql('SUM(T[x]) / 12'), 'ROUND(SUM(x) / 12, 4)');
  assert.equal(sql('DIVIDE(SUM(T[x]), SUM(T[n]))'), 'ROUND(SUM(x) / NULLIF(SUM(n), 0), 4)');
  assert.equal(sql('AVERAGEX(T, CONVERT(T[x], DOUBLE))'), 'AVG(x)');
  assert.equal(sql('SUMX(T, T[x] * T[n])'), 'SUM(x * n)');
});

test("SQL's NULLs: = NULL, <> NULL and NOT IN a list with a NULL keep no row", async () => {
  for (const c of ['comm = NULL', 'comm <> NULL', 'comm NOT IN (0, NULL)', 'comm IN (0, NULL)', 'NOT (comm IN (300, NULL))',
    'NOT (comm NOT IN (300, 500))', 'comm NOT IN (300, 500)', 'comm BETWEEN NULL AND 500', 'NOT (comm + NULL > 0)'])
    await same(`SELECT AGG(emp_count) AS n FROM m.emp WHERE ${c}`, `SELECT COUNT(*) FROM s.emp WHERE ${c}`);
});

test('LIKE and NOT LIKE leave out NULLs', async () => {
  for (const c of ["label NOT LIKE 'a%'", "NOT label LIKE 'a%'", "label LIKE '%%'", "label LIKE ''", "NOT (label LIKE '%b%')",
    "label NOT LIKE '%a'"])
    await same(`SELECT AGG(events) AS n FROM m.ev WHERE ${c}`, `SELECT COUNT(*) FROM s.ev WHERE ${c}`);
});

test('IN and NOT IN a subquery with a NULL in it', async () => {
  for (const c of ['comm IN (SELECT comm FROM m.emp)', 'comm NOT IN (SELECT comm FROM m.emp)',
    "comm NOT IN (SELECT comm FROM m.emp WHERE job = 'SALESMAN')", "NOT (comm IN (SELECT comm FROM m.emp WHERE job = 'SALESMAN'))",
    "deptno NOT IN (SELECT deptno FROM m.dept WHERE dname = 'SALES')"])
    await same(`SELECT AGG(emp_count) AS n FROM m.emp WHERE ${c}`, `SELECT COUNT(*) FROM s.emp WHERE ${c.replaceAll('m.', 's.')}`);
});

test("CAST AS DATE drops the time; %, LOG(b, x) and || as SQL has them", async () => {
  await same("SELECT AGG(events) AS n FROM m.ev WHERE CAST(ts AS DATE) = DATE '2024-01-02'",
    "SELECT COUNT(*) FROM s.ev WHERE CAST(ts AS DATE) = DATE '2024-01-02'");
  await same('SELECT CAST(ts AS DATE) AS d, AGG(events) AS n FROM m.ev GROUP BY CAST(ts AS DATE)',
    'SELECT CAST(ts AS DATE), COUNT(*) FROM s.ev GROUP BY 1');
  await same('SELECT id, n % 3 AS r, LOG(2, id * 4) AS l, label || 1 + 2 AS t, AGG(events) AS c FROM m.ev GROUP BY ALL',
    'SELECT id, n % 3, LOG(2, id * 4), label || 1 + 2, COUNT(*) FROM s.ev GROUP BY ALL');
  assert.throws(() => dax.compile('SELECT TRIM(label) AS t, AGG(events) AS n FROM m.ev GROUP BY label'), e => e.code === 'UNSUPPORTED');
});

test('over a join: FETCH WITH TIES; a subquery whose WHERE a RIGHT JOIN would pad', async () => {
  await same('SELECT e.job, AGG(e.emp_count) AS n FROM m.emp AS e RIGHT JOIN m.dept AS d ON e.deptno = d.deptno GROUP BY e.job ORDER BY n DESC FETCH FIRST 1 ROWS WITH TIES',
    'SELECT e.job, COUNT(e.empno) AS n FROM s.emp AS e RIGHT JOIN s.dept AS d ON e.deptno = d.deptno GROUP BY e.job QUALIFY rank() OVER (ORDER BY n DESC) <= 1');
  // Its WHERE cannot be the outer query's (that would drop the padded rows): not supported, not wrong.
  assert.throws(() => dax.compile('SELECT d.dname, AGG(d.dept_count) AS n FROM (SELECT empno, deptno FROM m.emp WHERE sal > 2000) AS x RIGHT JOIN m.dept AS d ON x.deptno = d.deptno GROUP BY d.dname'),
    e => e.code === 'UNSUPPORTED');
});
