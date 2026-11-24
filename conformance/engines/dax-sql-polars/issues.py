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

run("05 generate_series 2 * INTERVAL", lambda: pl.SQLContext().execute(
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
run("09 outer row read in a derived table of a subquery", lambda: pl.SQLContext(t=t).execute(
    "SELECT (SELECT b.v FROM (SELECT o.a * 10 AS v) AS b) AS r FROM t AS o", eager=True).rows())
run("10 failing CAST in a CASE branch no row takes", lambda: pl.SQLContext(t=t).execute(
    "SELECT CASE WHEN a > 5 THEN CAST('x' AS INTEGER) ELSE a END AS r FROM t", eager=True).rows())

# Smallest forms of the errors the correlated plan meets on the suite (each against DuckDB).
import duckdb  # noqa: E402

print("\n### The smallest forms, Polars and DuckDB\n")
SMALL = [
    ("o1 outer row, subquery with no FROM", "SELECT a, (SELECT o.a + 1) AS r FROM t AS o"),
    ("o2 outer row, derived table with no FROM", "SELECT a, (SELECT b.v FROM (SELECT o.a * 10 AS v) AS b) AS r FROM t AS o"),
    ("o3 outer row, LATERAL with no FROM", "SELECT o.a, x.v FROM t AS o, LATERAL (SELECT o.a + 1 AS v) AS x"),
    ("e1 EXISTS over a LEFT JOIN", "SELECT a FROM t AS o WHERE EXISTS (SELECT * FROM t AS l LEFT JOIN t AS r ON l.a = r.a WHERE l.a = o.a)"),
    ("e2 EXISTS OR EXISTS", "SELECT a FROM t AS o WHERE EXISTS (SELECT 1 FROM t AS i WHERE i.a = o.a) OR EXISTS (SELECT 1 FROM t AS i WHERE i.a = o.a + 1)"),
    ("e3 EXISTS two levels out", "SELECT a, (SELECT COUNT(*) FROM t AS m WHERE EXISTS (SELECT 1 FROM t AS i WHERE i.a = o.a AND i.a = m.a)) AS n FROM t AS o"),
    ("e4 EXISTS in a derived table of a subquery", "SELECT a, (SELECT COUNT(*) FROM (SELECT * FROM t AS m WHERE EXISTS (SELECT 1 FROM t AS i WHERE i.a = m.a AND i.a = o.a)) AS s) AS n FROM t AS o"),
    ("e5 EXISTS in a LATERAL", "SELECT o.a, x.n FROM t AS o, LATERAL (SELECT COUNT(*) AS n FROM t AS m WHERE EXISTS (SELECT 1 FROM t AS i WHERE i.a = m.a AND i.a <= o.a)) AS x"),
    ("d1 date_trunc of an outer column", "SELECT ts, (SELECT COUNT(*) FROM u AS i WHERE i.ts >= date_trunc('month', o.ts)) AS n FROM u AS o"),
    ("d2 date_trunc of an outer column in a LATERAL", "SELECT o.ts, x.n FROM u AS o, LATERAL (SELECT COUNT(*) AS n FROM u AS i WHERE i.ts >= date_trunc('year', o.ts)) AS x"),
    ("c1 CAST of a column in a branch no row takes", "SELECT CASE WHEN s <> 'x' THEN CAST(s AS INTEGER) END AS r FROM v"),
]
frames = {"t": pl.DataFrame({"a": [1, 2, 3]}),
          "u": pl.DataFrame({"ts": [datetime.datetime(2024, 1, 31), datetime.datetime(2024, 2, 29), datetime.datetime(2024, 3, 1)]}),
          "v": pl.DataFrame({"s": ["1", "x"]})}
duck = duckdb.connect()
for k, f in frames.items():
    duck.register(k, f.to_arrow())
for name, q in SMALL:
    try:
        want = sorted(duck.execute(q).fetchall(), key=str)
    except Exception as e:  # noqa: BLE001
        want = f"error: {str(e).splitlines()[0]}"
    run(f"{name} (DuckDB: {want})", lambda q=q: sorted(pl.SQLContext(**frames).execute(q, eager=True).rows(), key=str))
