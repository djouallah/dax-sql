# The SQL shapes dax-sql needs that Polars SQL lacked in 2.1.0, each on a three-row table, on the
# installed Polars and on DuckDB: one markdown table, for the job summary.
#   python repros.py            (Polars and duckdb installed)
import sys

import duckdb
import polars as pl

REPROS = [
    ("derived table in a subquery reads the outer row", "SELECT (SELECT b.v FROM (SELECT o.a * 10 AS v) AS b) AS r FROM t AS o"),
    ("WITH ... AS MATERIALIZED", "WITH x AS MATERIALIZED (SELECT a FROM t) SELECT * FROM x"),
    ("WITH ... AS NOT MATERIALIZED", "WITH x AS NOT MATERIALIZED (SELECT a FROM t) SELECT * FROM x"),
    ("ORDER BY inside SUM", "SELECT SUM(a ORDER BY a DESC) AS s FROM t"),
    ("error(msg)", "SELECT CASE WHEN a > 5 THEN error('boom') ELSE a END AS r FROM t"),
    ("CASE: failing cast in a branch no row takes", "SELECT CASE WHEN a > 5 THEN CAST('x' AS INTEGER) ELSE a END AS r FROM t"),
    ("LAST_DAY", "SELECT LAST_DAY(DATE '2024-02-10') AS d"),
    ("ASCII", "SELECT ASCII('A') AS c"),
    ("ROW(...)", "SELECT ROW(1, 'x') AS r"),
    ("list slicing", "SELECT [10, 20, 30][2:3] AS s"),
    ("LATERAL with LIMIT", "SELECT o.a, x.v FROM t AS o, LATERAL (SELECT o.a + 1 AS v LIMIT 1) AS x"),
    ("LATERAL with UNION ALL", "SELECT o.a, x.v FROM t AS o, LATERAL (SELECT o.a AS v UNION ALL SELECT o.a * 2) AS x"),
    ("LATERAL with SELECT *", "SELECT o.a, x.* FROM t AS o, LATERAL (SELECT * FROM t AS i WHERE i.a = o.a) AS x"),
    ("LATERAL with a window", "SELECT o.a, x.r FROM t AS o, LATERAL (SELECT ROW_NUMBER() OVER (ORDER BY i.a) AS r FROM t AS i WHERE i.a <= o.a) AS x"),
]


def rows_text(rows):
    return ", ".join("(" + ", ".join(str(v) for v in r) + ")" for r in sorted(rows, key=str))


def cell(s):
    return str(s).replace("|", "\\|").replace("\n", " ")[:160]


def main():
    ctx = pl.SQLContext(t=pl.DataFrame({"a": [1, 2, 3]}))
    duck = duckdb.connect()
    duck.execute("CREATE TABLE t AS SELECT * FROM (VALUES (1), (2), (3)) v(a)")
    commit = getattr(pl, "__build_commit__", None) or ""
    print(f"### Polars {pl.__version__} {commit[:10]}\n")
    print("| shape | SQL | Polars | DuckDB | same |\n|---|---|---|---|---|")
    ok = 0
    for name, sql in REPROS:
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
        print(f"| {cell(name)} | `{cell(sql)}` | {cell(got)} | {cell(want)} | {'yes' if same else 'no'} |")
    print(f"\n{ok} of {len(REPROS)} answer as DuckDB does.\n")


if __name__ == "__main__":
    sys.exit(main())
