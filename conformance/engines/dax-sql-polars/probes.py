# What Polars SQL may lack that DuckDB has, each the smallest SQL on small tables, on the installed
# Polars (a main build: polars-probe.yml) and on DuckDB: one markdown table, each shape with whether
# Polars answers as DuckDB does, and each answer's types. For issues to file upstream.
#   python probes.py            (Polars and duckdb installed)
import datetime
import decimal
import sys

import duckdb
import polars as pl

PROBES = [
    # A CASE's branch no row takes.
    ("p1 failing constant CAST in a branch no row takes", "SELECT CASE WHEN a > 5 THEN CAST('x' AS INTEGER) ELSE a END AS r FROM t"),
    ("p1b failing CAST of a non-constant text in a branch no row takes", "SELECT CASE WHEN a > 5 THEN CAST(CASE WHEN random() < 2 THEN 'boom' END AS INTEGER) ELSE a END AS r FROM t"),
    ("p2 error() in a branch no row takes", "SELECT CASE WHEN a > 5 THEN error('boom') ELSE a END AS r FROM t"),
    ("p2b error() in a branch a row takes", "SELECT CASE WHEN a > 2 THEN error('boom') ELSE a END AS r FROM t"),
    # Calendar months.
    ("p3 a date plus a column's number of months", "SELECT d + n * INTERVAL '1 month' AS x FROM u"),
    ("p3b a timestamp plus a column's number of months", "SELECT ts + n * INTERVAL '1 month' AS x FROM u"),
    ("p3c a date plus a constant times months", "SELECT d + 2 * INTERVAL '1 month' AS x FROM u"),
    ("p4 a negative interval string", "SELECT d + INTERVAL '-1 months' AS x FROM u"),
    ("p4b a negative interval of days", "SELECT d + INTERVAL '-2 days' AS x FROM u"),
    # Decimals: a quotient's and an average's type and value.
    ("p5 DECIMAL(18,4) / an integer", "SELECT x / 3 AS q, typeof(x / 3) AS t FROM w"),
    ("p5b DECIMAL(18,4) / DECIMAL(18,4)", "SELECT x / y AS q, typeof(x / y) AS t FROM w"),
    ("p5c DOUBLE / DECIMAL(18,4)", "SELECT CAST(x AS DOUBLE PRECISION) / y AS q, typeof(CAST(x AS DOUBLE PRECISION) / y) AS t FROM w"),
    ("p5d AVG of DECIMAL(18,4)", "SELECT AVG(x) AS m, typeof(AVG(x)) AS t FROM w"),
    # generate_series.
    ("p6 generate_series, a step from a scalar subquery", "SELECT * FROM generate_series(TIMESTAMP '2024-01-01 00:00:00', TIMESTAMP '2024-01-05 00:00:00', (SELECT 2) * INTERVAL '1 day') AS g(v)"),
    ("p7 generate_series, bounds from the FROM before it", "SELECT o.a, g.v FROM t AS o, generate_series(1, o.a) AS g(v)"),
    ("p7b the same with CROSS JOIN LATERAL", "SELECT o.a, g.v FROM t AS o CROSS JOIN LATERAL generate_series(1, o.a) AS g(v)"),
    # Functions.
    ("p8 ascii", "SELECT ascii('A') AS c"),
    ("p8b unicode", "SELECT unicode('é') AS c"),
    ("p9 factorial", "SELECT factorial(5) AS f"),
    ("p10 a time in a zone, AT TIME ZONE", "SELECT CAST(TIMESTAMPTZ '2024-01-01 10:00:00+02' AT TIME ZONE 'UTC' AS TIMESTAMP) AS x"),
    ("p10b now() AT TIME ZONE 'UTC' (its type)", "SELECT typeof(now() AT TIME ZONE 'UTC') AS t"),
    ("p10c timezone('UTC', now()) (its type)", "SELECT typeof(timezone('UTC', now())) AS t"),
    ("p11 last_day", "SELECT last_day(DATE '2024-02-10') AS d"),
    ("p12 one-argument LOG", "SELECT LOG(100.0) AS x"),
    ("p13 SUM(... ORDER BY ...)", "SELECT SUM(a ORDER BY a DESC) AS s FROM t"),
    ("p14 printf('%.14e')", "SELECT printf('%.14e', 1234.5) AS s"),
    ("p14b format('{:.14e}')", "SELECT format('{:.14e}', 1234.5) AS s"),
    # Negative whole numbers.
    ("p15 a negative BIGINT as text", "SELECT CAST(CAST(-3 AS BIGINT) AS TEXT) AS s"),
    ("p15b power with a negative BIGINT exponent", "SELECT power(10.0, CAST(-3 AS BIGINT)) AS x"),
    ("p15c power with a negative literal exponent", "SELECT power(10.0, -3) AS x"),
    ("p15d floor(log10(..)) of a small number as BIGINT, as text", "SELECT CAST(CAST(floor(log10(abs(a / 1000.0))) AS BIGINT) AS TEXT) AS s FROM t"),
    # A DATE and a time of day (cf. pola-rs/polars#20397).
    ("p16 a DATE plus hours", "SELECT d + INTERVAL '6 hours' AS x FROM u"),
    ("p16b EXTRACT(HOUR) of a DATE", "SELECT EXTRACT(HOUR FROM d) AS h FROM u"),
]

# A range join: the plan Polars makes of it (an IE join, or a cross join and a filter).
RANGE = "SELECT COUNT(*) AS n FROM t AS l JOIN r ON l.a >= r.lo AND l.a <= r.hi"


def value(v):
    if isinstance(v, datetime.datetime) and v.time() == datetime.time():
        return v.date()
    if isinstance(v, decimal.Decimal):
        return format(v, "f")
    return v


def rows_text(rows):
    return ", ".join("(" + ", ".join(str(value(v)) for v in r) + ")" for r in sorted(rows, key=str))


def cell(s):
    return str(s).replace("|", "\|").replace("\n", " ")[:160]


def main():
    days = [datetime.date(2024, 1, 31), datetime.date(2024, 2, 29), datetime.date(2024, 3, 1)]
    frames = {
        "t": pl.DataFrame({"a": [1, 2, 3]}),
        "u": pl.DataFrame({"d": days, "ts": [datetime.datetime.combine(d, datetime.time(10, 30)) for d in days], "n": [1, 2, -1]}),
        "w": pl.DataFrame({"x": [decimal.Decimal("1.0000"), decimal.Decimal("2.0000")], "y": [decimal.Decimal("3.0000"), decimal.Decimal("7.0000")]},
                          schema={"x": pl.Decimal(18, 4), "y": pl.Decimal(18, 4)}),
        "r": pl.DataFrame({"lo": [0, 2], "hi": [1, 3]}),
    }
    ctx = pl.SQLContext(**frames)
    duck = duckdb.connect()
    for name, df in frames.items():
        duck.register(f"{name}_src", df.to_arrow())
        duck.execute(f"CREATE TABLE {name} AS SELECT * FROM {name}_src")
    commit = getattr(pl, "__build_commit__", None) or ""
    print(f"### Probes: Polars {pl.__version__} {commit[:10]}, DuckDB {duckdb.__version__}\n")
    print("| probe | Polars | DuckDB | same |\n|---|---|---|---|")
    for name, sql in PROBES:
        try:
            want = rows_text(duck.execute(sql).fetchall())
        except Exception as e:  # noqa: BLE001
            want = "error: " + str(e).splitlines()[0]
        try:
            got = rows_text(ctx.execute(sql, eager=True).rows())
        except Exception as e:  # noqa: BLE001
            got = f"{type(e).__name__}: " + (str(e).splitlines()[0] if str(e) else "")
        print(f"| {cell(name)} | {cell(got)} | {cell(want)} | {'yes' if got == want else '**no**'} |")
    print("\n#### A range join's plan on Polars\n")
    print("```")
    try:
        print(ctx.execute(RANGE).explain())
    except Exception as e:  # noqa: BLE001
        print(f"{type(e).__name__}: {e}")
    print("```\n")
    for label, q in [("Polars", None), ("DuckDB", RANGE)]:
        try:
            out = ctx.execute(RANGE, eager=True).rows() if q is None else duck.execute(q).fetchall()
        except Exception as e:  # noqa: BLE001
            out = f"{type(e).__name__}: {e}"
        print(f"- {label}: {out}")


if __name__ == "__main__":
    sys.exit(main())
