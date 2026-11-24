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
