# The Polars issue drafts' reproducible examples, each exactly as drafted, run on the Polars of
# this job (main): what each prints, for the report's log output. polars.yml runs it.
import datetime
import time

import polars as pl

print(f"### The issue drafts on Polars {pl.__version__}\n")


def run(name, f):
    try:
        out = f()
        print(f"- {name}: no error: {out}")
    except Exception as e:  # noqa: BLE001
        print(f"- {name}: {type(e).__module__}.{type(e).__name__}: {str(e).splitlines()[0]}")


df = pl.DataFrame({"d": [datetime.date(2024, 1, 1)], "ts": [datetime.datetime(2024, 1, 1)]})
run("04 DATE = TIMESTAMP join", lambda: pl.SQLContext(t=df).execute("SELECT COUNT(*) FROM t AS a JOIN t AS b ON a.d = b.ts", eager=True).rows())

run("05 generate_series 2 * INTERVAL (#31042, fixed by #31054)", lambda: pl.SQLContext().execute(
    "SELECT * FROM generate_series(TIMESTAMP '2024-01-01', TIMESTAMP '2024-01-05', 2 * INTERVAL '1 day')", eager=True).rows())

sql = "SELECT " + "CASE WHEN a > 0 THEN " * 60 + "a" + " ELSE 0 END" * 60 + " FROM t"
run("06 60 nested CASEs", lambda: pl.SQLContext(t=pl.DataFrame({"a": [1]})).execute(sql, eager=True).rows())

ctx = pl.SQLContext(x=pl.DataFrame({"k": [i % 3000 for i in range(200_000)]}), y=pl.DataFrame({"k": list(range(3000))}))
for on in ["x.k = y.k", "x.k IS NOT DISTINCT FROM y.k"]:
    t0 = time.perf_counter()
    ctx.execute(f"SELECT COUNT(*) FROM x JOIN y ON {on}", eager=True)
    print(f"- 07 {on}: {time.perf_counter() - t0:.3f} s")

# Drafts not filed yet: what the correlated plan and DAX's runtime errors need.
t = pl.DataFrame({"a": [1, 2, 3]})
run("08 LATERAL with no FROM of its own", lambda: pl.SQLContext(t=t).execute(
    "SELECT o.a, x.v FROM t AS o, LATERAL (SELECT o.a + 1 AS v) AS x", eager=True).rows())
run("08b LATERAL over a table (answers)", lambda: pl.SQLContext(t=t).execute(
    "SELECT o.a, x.v FROM t AS o, LATERAL (SELECT i.a AS v FROM t AS i WHERE i.a > o.a) AS x", eager=True).rows())
run("09 outer row read in a derived table of a subquery (#31058)", lambda: pl.SQLContext(t=t).execute(
    "SELECT (SELECT b.v FROM (SELECT o.a * 10 AS v) AS b) AS r FROM t AS o", eager=True).rows())
run("10 failing CAST in a CASE branch no row takes", lambda: pl.SQLContext(t=t).execute(
    "SELECT CASE WHEN a > 5 THEN CAST('x' AS INTEGER) ELSE a END AS r FROM t", eager=True).rows())

# Smallest forms of the errors the correlated plan meets on the suite (each against DuckDB).
import duckdb  # noqa: E402

print("\n### The smallest forms, Polars and DuckDB\n")
SMALL = [
    ("o1 outer row, subquery with no FROM", "SELECT a, (SELECT o.a + 1) AS r FROM t AS o"),
    ("o2 outer row, derived table with no FROM (#31058)", "SELECT a, (SELECT b.v FROM (SELECT o.a * 10 AS v) AS b) AS r FROM t AS o"),
    ("o3 outer row, LATERAL with no FROM", "SELECT o.a, x.v FROM t AS o, LATERAL (SELECT o.a + 1 AS v) AS x"),
    ("e1 EXISTS over a LEFT JOIN", "SELECT a FROM t AS o WHERE EXISTS (SELECT * FROM t AS l LEFT JOIN t AS r ON l.a = r.a WHERE l.a = o.a)"),
    ("e2 EXISTS OR EXISTS", "SELECT a FROM t AS o WHERE EXISTS (SELECT 1 FROM t AS i WHERE i.a = o.a) OR EXISTS (SELECT 1 FROM t AS i WHERE i.a = o.a + 1)"),
    ("e3 EXISTS two levels out", "SELECT a, (SELECT COUNT(*) FROM t AS m WHERE EXISTS (SELECT 1 FROM t AS i WHERE i.a = o.a AND i.a = m.a)) AS n FROM t AS o"),
    ("e4 EXISTS in a derived table of a subquery (#31059)", "SELECT a, (SELECT COUNT(*) FROM (SELECT * FROM t AS m WHERE EXISTS (SELECT 1 FROM t AS i WHERE i.a = m.a AND i.a = o.a)) AS s) AS n FROM t AS o"),
    ("e5 EXISTS in a LATERAL (#31059)", "SELECT o.a, x.n FROM t AS o, LATERAL (SELECT COUNT(*) AS n FROM t AS m WHERE EXISTS (SELECT 1 FROM t AS i WHERE i.a = m.a AND i.a <= o.a)) AS x"),
    ("d1 date_trunc of an outer column", "SELECT ts, (SELECT COUNT(*) FROM u AS i WHERE i.ts >= date_trunc('month', o.ts)) AS n FROM u AS o"),
    ("d2 date_trunc of an outer column in a LATERAL", "SELECT o.ts, x.n FROM u AS o, LATERAL (SELECT COUNT(*) AS n FROM u AS i WHERE i.ts >= date_trunc('year', o.ts)) AS x"),
    ("c1 CAST of a column in a branch no row takes", "SELECT CASE WHEN s <> 'x' THEN CAST(s AS INTEGER) END AS r FROM v"),
    # The outer column read unqualified (as dax-sql writes it: each column's name unique in the query).
    ("u1 unqualified outer column, derived table with no FROM", "SELECT x, (SELECT b.v FROM (SELECT x * 10 AS v) AS b) AS r FROM (SELECT a AS x FROM t) AS o"),
    ("u2 unqualified outer column, derived table's WHERE", "SELECT x, (SELECT COUNT(*) FROM (SELECT * FROM t AS i WHERE i.a <= x) AS s) AS n FROM (SELECT a AS x FROM t) AS o"),
    ("u2q the same qualified", "SELECT x, (SELECT COUNT(*) FROM (SELECT * FROM t AS i WHERE i.a <= o.x) AS s) AS n FROM (SELECT a AS x FROM t) AS o"),
    ("u3 unqualified outer column, LATERAL's derived table", "SELECT o.x, l.y FROM (SELECT a AS x FROM t) AS o, LATERAL (SELECT DISTINCT * FROM (SELECT i.a AS y FROM t AS i WHERE i.a <= x) AS s) AS l"),
    ("u3q the same qualified", "SELECT o.x, l.y FROM (SELECT a AS x FROM t) AS o, LATERAL (SELECT DISTINCT * FROM (SELECT i.a AS y FROM t AS i WHERE i.a <= o.x) AS s) AS l"),
    ("u4 LATERAL of a UNION ALL reading the outer row", "SELECT o.x, l.y FROM (SELECT a AS x FROM t) AS o, LATERAL (SELECT y FROM (SELECT a AS y FROM t WHERE a <= o.x) AS p UNION ALL SELECT y FROM (SELECT a AS y FROM t WHERE a > o.x) AS q) AS l"),
    # DATE_TRUNC "cannot determine the type", as the suite's correlated plan meets it.
    ("d3 date_trunc of an unqualified outer column, scalar subquery", "SELECT ts0, (SELECT COUNT(*) FROM u AS i WHERE i.ts >= date_trunc('month', ts0)) AS n FROM (SELECT ts AS ts0 FROM u) AS o"),
    ("d4 date_trunc of an unqualified outer column, LATERAL", "SELECT o.ts0, x.n FROM (SELECT ts AS ts0 FROM u) AS o, LATERAL (SELECT COUNT(*) AS n FROM u AS i WHERE i.ts >= date_trunc('year', ts0)) AS x"),
    ("d5 LATERAL SELECT * over a derived table, date_trunc of o.ts0 cast", "SELECT * FROM (SELECT ts AS ts0 FROM u) AS o, LATERAL (SELECT * FROM (SELECT ts AS ts1 FROM u) AS s WHERE ts1 >= CAST(CAST(date_trunc('year', o.ts0) AS DATE) AS TIMESTAMP) AND ts1 <= o.ts0) AS a"),
    ("d6 LATERAL SELECT * over a table, date_trunc of o.ts0 in COALESCE", "SELECT * FROM (SELECT ts AS ts0 FROM u) AS o, LATERAL (SELECT * FROM u AS s WHERE COALESCE(s.ts, TIMESTAMP '1899-12-30 00:00:00') >= COALESCE(CAST(CAST(date_trunc('year', o.ts0) AS DATE) AS TIMESTAMP), TIMESTAMP '1899-12-30 00:00:00')) AS a"),
    ("d7 LATERAL SELECT * over a table, date_trunc of o.ts0", "SELECT * FROM (SELECT ts AS ts0 FROM u) AS o, LATERAL (SELECT * FROM u AS s WHERE s.ts >= date_trunc('year', o.ts0)) AS a"),
    ("d8 correlated EXISTS, date_trunc of the outer column", "SELECT ts0 FROM (SELECT ts AS ts0 FROM u) AS o WHERE EXISTS (SELECT 1 FROM u AS i WHERE i.ts >= date_trunc('month', o.ts0))"),
    ("d9 correlated EXISTS, date_trunc of the inner column", "SELECT a FROM t AS o WHERE EXISTS (SELECT 1 FROM u AS i WHERE date_trunc('month', i.ts) <= i.ts AND o.a > 1)"),
    ("d10 correlated scalar subquery over a CTE, date_trunc of its column", "WITH c AS (SELECT ts AS ts1 FROM u) SELECT a, (SELECT COUNT(*) FROM c WHERE date_trunc('month', ts1) <= ts1 AND a > 1) AS n FROM t"),
    ("d11 LATERAL over a CTE, date_trunc of the outer column", "WITH c AS (SELECT ts AS ts1 FROM u) SELECT * FROM (SELECT ts AS ts0 FROM u) AS o, LATERAL (SELECT * FROM c WHERE ts1 >= date_trunc('year', o.ts0)) AS a"),
    ("d12 correlated IN, date_trunc of an outer column a scalar subquery made", "SELECT ts FROM (SELECT ts, (SELECT MAX(ts) FROM u) AS m FROM u) AS o WHERE ts IN (SELECT ts1 FROM (SELECT ts AS ts1 FROM u) AS s WHERE ts1 >= date_trunc('year', m))"),
    ("d13 the same, o.m qualified", "SELECT ts FROM (SELECT ts, (SELECT MAX(ts) FROM u) AS m FROM u) AS o WHERE ts IN (SELECT ts1 FROM (SELECT ts AS ts1 FROM u) AS s WHERE ts1 >= date_trunc('year', o.m))"),
    ("d14 correlated IN with no derived table", "SELECT ts FROM (SELECT ts, (SELECT MAX(ts) FROM u) AS m FROM u) AS o WHERE ts IN (SELECT i.ts FROM u AS i WHERE i.ts >= date_trunc('year', o.m))"),
    ("d15 correlated IN, the outer column a plain one", "SELECT ts FROM (SELECT ts, ts AS m FROM u) AS o WHERE ts IN (SELECT i.ts FROM u AS i WHERE i.ts >= date_trunc('year', o.m))"),
    ("d16 correlated IN, no date_trunc", "SELECT ts FROM (SELECT ts, (SELECT MAX(ts) FROM u) AS m FROM u) AS o WHERE ts IN (SELECT i.ts FROM u AS i WHERE i.ts <= o.m)"),
    ("u5 LATERAL over a CTE, reading nothing outside", "WITH c AS (SELECT MAX(a) AS m FROM t) SELECT o.a, l.m FROM t AS o, LATERAL (SELECT m FROM c) AS l"),
]
frames = {"t": pl.DataFrame({"a": [1, 2, 3]}),
          "u": pl.DataFrame({"ts": [datetime.datetime(2024, 1, 31), datetime.datetime(2024, 2, 29), datetime.datetime(2024, 3, 1)]}),
          "v": pl.DataFrame({"s": ["1", "x"]})}
duck = duckdb.connect()
duck.execute("CREATE TABLE t AS SELECT * FROM (VALUES (1), (2), (3)) v(a)")
duck.execute("CREATE TABLE u AS SELECT * FROM (VALUES (TIMESTAMP '2024-01-31'), (TIMESTAMP '2024-02-29'), (TIMESTAMP '2024-03-01')) v(ts)")
duck.execute("CREATE TABLE v AS SELECT * FROM (VALUES ('1'), ('x')) v(s)")
for name, q in SMALL:
    try:
        want = sorted(duck.execute(q).fetchall(), key=str)
    except Exception as e:  # noqa: BLE001
        want = f"error: {str(e).splitlines()[0]}"
    run(f"{name} (DuckDB: {want})", lambda q=q: sorted(pl.SQLContext(**frames).execute(q, eager=True).rows(), key=str))


# The DATE_TRUNC type error as the suite meets it: contoso fuzz2-0101's correlated SQL as dax-sql
# writes it (fuzz2-0101.sql), over three small tables, then smaller forms of it.
import pathlib  # noqa: E402

print("\n### DATE_TRUNC: contoso fuzz2-0101 and smaller forms\n")
days = [datetime.datetime(2023, 1, 1), datetime.datetime(2024, 6, 1), datetime.datetime(2024, 12, 31)]
small = pl.SQLContext(**{
    "contoso__Date": pl.DataFrame({"Date": days}),
    "contoso__Sales": pl.DataFrame({"OrderDate": days, "ProductKey": [1, 2, 1], "Amount": [10.0, 20.0, 30.0]}),
    "contoso__Product": pl.DataFrame({"ProductKey": [1, 2], "Color": ["Red", "Blue"]}),
}, u=frames["u"], t=frames["t"])
whole = pathlib.Path(__file__).with_name("fuzz2-0101.sql").read_text()
run("f0 fuzz2-0101 as dax-sql writes it", lambda: small.execute(whole, eager=True).rows())
for name, q in [
    ("f1 CTE with a scalar subquery column, IN reading it in date_trunc", "WITH c AS (SELECT ts, (SELECT MAX(ts) FROM u) AS m FROM u) SELECT ts FROM c WHERE ts IN (SELECT ts1 FROM (SELECT ts AS ts1 FROM u) AS s WHERE ts1 >= date_trunc('year', m))"),
    ("f2 the same under GROUP BY", "WITH c AS (SELECT ts, 1 AS g, (SELECT MAX(ts) FROM u) AS m FROM u) SELECT g, COUNT(*) AS n FROM c WHERE ts IN (SELECT ts1 FROM (SELECT ts AS ts1 FROM u) AS s WHERE ts1 >= date_trunc('year', m)) GROUP BY g"),
    ("f3 the scalar subquery over a DISTINCT CTE, SELECT *", "WITH d AS (SELECT DISTINCT ts AS t5 FROM u), c AS (SELECT *, (SELECT MAX(t5) AS m FROM d AS s4) AS m FROM u) SELECT ts FROM c WHERE ts IN (SELECT ts1 FROM (SELECT ts AS ts1 FROM u) AS s WHERE ts1 >= date_trunc('year', m))"),
    ("f4 f3 with the CAST and COALESCE dax-sql writes", "WITH d AS (SELECT DISTINCT ts AS t5 FROM u), c AS (SELECT *, (SELECT MAX(t5) AS m FROM d AS s4) AS m FROM u) SELECT ts FROM c WHERE ts IN (SELECT ts1 FROM (SELECT ts AS ts1 FROM u) AS s WHERE COALESCE(ts1, TIMESTAMP '1899-12-30 00:00:00') >= COALESCE(CAST(CAST(date_trunc('year', m) AS DATE) AS TIMESTAMP), TIMESTAMP '1899-12-30 00:00:00'))"),
    ("f5 no IN: the scalar subquery column in date_trunc in a WHERE", "WITH c AS (SELECT ts, (SELECT MAX(ts) FROM u) AS m FROM u) SELECT ts FROM c WHERE ts >= date_trunc('year', m)"),
    ("f6 no CTE: a derived table with the scalar subquery column", "SELECT ts FROM (SELECT ts, (SELECT MAX(ts) FROM u) AS m FROM u) AS c WHERE ts >= date_trunc('year', m)"),
]:
    run(name, lambda q=q: sorted(small.execute(q, eager=True).rows(), key=str))
# fuzz2-0101 cut down: its CTEs up to the one that fails, and the shape there (a scalar subquery's
# column added to a LEFT JOIN's rows, read in DATE_TRUNC inside an IN).
cut = whole[: whole.index(",\nw34 AS")] + "\nSELECT * FROM v1"
run("g1 fuzz2-0101's CTEs up to v1", lambda: small.execute(cut, eager=True).rows())
J = "WITH j AS (SELECT * FROM u AS a LEFT JOIN (SELECT ts AS ts2 FROM u) AS b ON ts2 = a.ts), c AS (SELECT *, (SELECT MAX(ts) FROM u) AS m FROM j) "
for name, q in [
    ("g2 a scalar subquery's column added to a LEFT JOIN, IN reading it in date_trunc", J + "SELECT ts FROM c WHERE ts IN (SELECT ts1 FROM (SELECT ts AS ts1 FROM u) AS s WHERE ts1 >= date_trunc('year', m))"),
    ("g3 g2 without the IN", J + "SELECT ts FROM c WHERE ts >= date_trunc('year', m)"),
    ("g4 g2 with a join of no LEFT", "WITH j AS (SELECT * FROM u AS a JOIN (SELECT ts AS ts2 FROM u) AS b ON ts2 = a.ts), c AS (SELECT *, (SELECT MAX(ts) FROM u) AS m FROM j) SELECT ts FROM c WHERE ts >= date_trunc('year', m)"),
    ("g5 g3 selecting date_trunc instead", J + "SELECT date_trunc('year', m) AS y FROM c"),
    ("g6 a LEFT JOIN's column (no scalar subquery) in date_trunc", "WITH j AS (SELECT * FROM u AS a LEFT JOIN (SELECT ts AS ts2 FROM u) AS b ON ts2 = a.ts) SELECT date_trunc('year', ts2) AS y FROM j"),
]:
    run(name, lambda q=q: sorted(small.execute(q, eager=True).rows(), key=str))
