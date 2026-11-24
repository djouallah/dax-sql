# The SQL shapes dax-sql's Polars dialect works around (src/dialects/polars.js, plan-sql.js), and
# those Polars SQL lacks, each on a small table, on the installed Polars and on DuckDB: one
# markdown table for the job summary, each shape with whether Polars answers as DuckDB does.
#   python repros.py            (Polars and duckdb installed)
import datetime
import sys
import time

import duckdb
import polars as pl

# (shape, SQL, what dax-sql does for it)
REPROS = [
    # --- answers or errors where there should be none ---
    ("strpos's needle is text, not a pattern", "SELECT strpos('abc', '|b|') AS x", "a text's position by split_part"),
    ("IS NOT DISTINCT FROM between two CASTs in a join", "SELECT COUNT(*) AS n FROM t AS l JOIN (SELECT a AS b FROM t) AS r ON CAST(l.a AS BIGINT) IS NOT DISTINCT FROM CAST(r.b AS BIGINT)", "keys as = of COALESCE with a value no data holds"),
    ("IS NOT DISTINCT FROM beside an expression key", "SELECT COUNT(*) AS n FROM t AS l JOIN (SELECT a AS b FROM t) AS r ON l.a IS NOT DISTINCT FROM r.b AND CAST(l.a AS BIGINT) = CAST(r.b AS BIGINT)", "keys as = of COALESCE with a value no data holds"),
    ("a constant's comparison in a join's ON", "SELECT COUNT(*) AS n FROM t AS l JOIN (SELECT a AS b FROM t) AS r ON l.a = r.b AND r.b = 2", "an inner join's other conditions its WHERE"),
    ("a left join's ON with a condition on its right alone", "SELECT COUNT(*) AS n FROM t AS l LEFT JOIN (SELECT a AS b FROM t) AS r ON l.a = r.b AND r.b = 2", "the condition a filter of the right"),
    ("join keys DATE and TIMESTAMP", "SELECT COUNT(*) AS n FROM u AS l JOIN (SELECT ts FROM u) AS r ON l.d = r.ts", "every date a TIMESTAMP"),
    ("CASE: failing cast in a branch no row takes", "SELECT CASE WHEN a > 5 THEN CAST('x' AS INTEGER) ELSE a END AS r FROM t", "lengths at least 0, divisors at least 1, 64-bit whole numbers"),
    ("CASE: log10 of a negative in a branch no row takes", "SELECT CASE WHEN a < 0 THEN log10(a) ELSE 0 END AS r FROM t", "abs() before log10"),
    ("CASE: overflow in a branch no row takes", "SELECT CASE WHEN a > 5 THEN CAST(a AS BIGINT) * 9223372036854775807 ELSE 0 END AS r FROM t", "multipliers kept small"),
    ("integer division of BIGINT by INTEGER", "SELECT CAST(7 AS BIGINT) // CAST(2 AS INTEGER) AS x", "both cast to BIGINT"),
    ("CAST of a double to DECIMAL keeps its value", "SELECT CAST(CAST(2.675 AS DOUBLE PRECISION) AS DECIMAL(38,22)) AS x", "the double's text read as a DECIMAL"),
    ("a deep query (60 nested subqueries)", "SELECT a FROM " + "(SELECT a FROM " * 60 + "t" + ") AS s" * 60, "each relation a CTE"),
    ("a deep expression (60 nested CASEs)", "SELECT " + "CASE WHEN a > 0 THEN " * 60 + "a" + " ELSE 0 END" * 60 + " AS x FROM t", "each relation a CTE"),
    ("TRY_CAST of an ambiguous date", "SELECT TRY_CAST('3/5/2024' AS DATE) AS x", "M/D/YYYY written as ISO first"),
    # --- what Polars SQL lacks ---
    ("n * INTERVAL '1 month'", "SELECT d + n * INTERVAL '1 month' AS x FROM (SELECT d, 2 AS n FROM u) AS w", "months from a date's parts"),
    ("a negative interval", "SELECT d + INTERVAL '-1 months' AS x FROM u", "d - INTERVAL '1 months'"),
    ("generate_series with a step of n days", "SELECT * FROM generate_series(TIMESTAMP '2024-01-01 00:00:00', TIMESTAMP '2024-01-05 00:00:00', 2 * INTERVAL '1 day') AS g(v)", "a series of days since 1970"),
    ("ROUND to a computed number of places", "SELECT ROUND(1.23456, a) AS x FROM t", "by powers of ten"),
    ("MAKE_DATE", "SELECT MAKE_DATE(2024, 2, 3) AS d", "a date from its parts' text"),
    ("TO_CHAR", "SELECT TO_CHAR(DATE '2024-02-03', 'YYYY') AS s", "FORMAT as standard functions"),
    ("REPEAT", "SELECT REPEAT('ab', 3) AS s", "LEFT of a constant"),
    ("CHR", "SELECT CHR(65) AS s", "none needed"),
    ("RANDOM", "SELECT RANDOM() < 2 AS b", "none needed"),
    ("one-argument LOG", "SELECT LOG(100.0) AS x", "log10"),
    ("PERCENTILE_CONT ... WITHIN GROUP", "SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY a) AS p FROM t", "row numbers and a window"),
    ("regexp_replace with a backreference", "SELECT regexp_replace('abc', '(b)', '[\\1]') AS s", "none needed"),
    ("derived table in a subquery reads the outer row", "SELECT (SELECT b.v FROM (SELECT o.a * 10 AS v) AS b) AS r FROM t AS o", "values written where read"),
    ("WITH ... AS MATERIALIZED", "WITH x AS MATERIALIZED (SELECT a FROM t) SELECT * FROM x", "no MATERIALIZED"),
    ("ORDER BY inside SUM", "SELECT SUM(a ORDER BY a DESC) AS s FROM t", "SUM without ORDER BY"),
    ("error(msg)", "SELECT CASE WHEN a > 5 THEN error('boom') ELSE a END AS r FROM t", "none needed"),
    ("LAST_DAY", "SELECT LAST_DAY(DATE '2024-02-10') AS d", "month arithmetic"),
    ("ASCII", "SELECT ASCII('A') AS c", "UNICODE by a table of characters"),
    ("ROW(...)", "SELECT ROW(1, 'x') AS r", "none needed"),
    ("list slicing", "SELECT [10, 20, 30][2:3] AS s", "SUBSTITUTE's instance by lengths"),
    ("LATERAL", "SELECT o.a, x.v FROM t AS o, LATERAL (SELECT o.a + 1 AS v LIMIT 1) AS x", "the query plan unnested"),
    ("a correlated scalar subquery", "SELECT a, (SELECT COUNT(*) FROM t AS i WHERE i.a <= o.a) AS n FROM t AS o", "the query plan unnested"),
]


def value(v):
    if isinstance(v, datetime.datetime) and v.time() == datetime.time():
        return v.date()
    return v


def rows_text(rows):
    return ", ".join("(" + ", ".join(str(value(v)) for v in r) + ")" for r in sorted(rows, key=str))


def cell(s):
    return str(s).replace("|", "\\|").replace("\n", " ")[:140]


def main():
    days = [datetime.date(2024, 1, 31), datetime.date(2024, 2, 29), datetime.date(2024, 3, 1)]
    ctx = pl.SQLContext(
        t=pl.DataFrame({"a": [1, 2, 3]}),
        u=pl.DataFrame({"d": days, "ts": [datetime.datetime.combine(d, datetime.time()) for d in days]}),
    )
    duck = duckdb.connect()
    duck.execute("CREATE TABLE t AS SELECT * FROM (VALUES (1), (2), (3)) v(a)")
    duck.execute("CREATE TABLE u AS SELECT d, CAST(d AS TIMESTAMP) AS ts FROM (VALUES (DATE '2024-01-31'), (DATE '2024-02-29'), (DATE '2024-03-01')) v(d)")
    commit = getattr(pl, "__build_commit__", None) or ""
    print(f"### Polars {pl.__version__} {commit[:10]}\n")
    print("| shape | Polars | DuckDB | same | dax-sql's workaround |\n|---|---|---|---|---|")
    ok = 0
    for name, sql, workaround in REPROS:
        try:
            want = rows_text(duck.execute(sql).fetchall())
        except Exception as e:  # noqa: BLE001
            want = "error: " + str(e).splitlines()[0]
        try:
            got = rows_text(ctx.execute(sql, eager=True).rows())
        except Exception as e:  # noqa: BLE001
            got = f"{type(e).__name__}: " + (str(e).splitlines()[0] if str(e) else "")
        same = got == want
        ok += same
        print(f"| {cell(name)} | {cell(got)} | {cell(want)} | {'yes' if same else '**no**'} | {cell(workaround)} |")
    print(f"\n{ok} of {len(REPROS)} answer as DuckDB does.\n")
    # A join on IS NOT DISTINCT FROM against one on =, the same keys (dax-sql writes the first as
    # the second, of COALESCE).
    n = 200_000
    big = pl.SQLContext(x=pl.DataFrame({"k": [i % 3000 for i in range(n)]}), y=pl.DataFrame({"k2": list(range(3000))}))
    times = {}
    for label, on in [("=", "k = k2"), ("IS NOT DISTINCT FROM", "k IS NOT DISTINCT FROM k2")]:
        t0 = time.time()
        big.execute(f"SELECT COUNT(*) FROM x JOIN y ON {on}", eager=True)
        times[label] = time.time() - t0
    print(f"Join of {n} rows to 3000 on `=`: {times['=']:.3f} s; on IS NOT DISTINCT FROM: {times['IS NOT DISTINCT FROM']:.3f} s "
          f"({times['IS NOT DISTINCT FROM'] / max(times['='], 1e-6):.0f} times).\n")


if __name__ == "__main__":
    sys.exit(main())
