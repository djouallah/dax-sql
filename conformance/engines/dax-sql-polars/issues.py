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
