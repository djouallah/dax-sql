# A model's data in a Polars SQLContext, answering SQL one query at a time, for adapter.mjs.
#   python worker.py <model dir> <name>
# Each table of the model.bim read from data/<entity>.csv with the bim's types, registered as
# <name>__<entity>. Prints {"ready": true}, then reads one JSON {"sql"} per line and answers each
# with one JSON line: {"rows": [...]} or {"error": "<class>: <first line>"}.
import datetime
import decimal
import json
import math
import sys

import polars as pl

TYPES = {"int64": pl.Int64, "double": pl.Float64, "decimal": pl.Decimal(18, 4), "string": pl.String, "boolean": pl.Boolean}


def load(model_dir, name):
    with open(model_dir + "/model.bim", encoding="utf-8-sig") as f:
        bim = json.load(f)
    ctx = pl.SQLContext()
    for t in bim["model"]["tables"]:
        source = ((t.get("partitions") or [{}])[0].get("source")) or {}
        if source.get("type") != "entity":
            continue
        path = f"{model_dir}/data/{source['entityName']}.csv"
        schema = {}
        for c in t["columns"]:
            if c.get("type") not in (None, "data"):
                continue
            dt = c["dataType"]
            # A DAX date is a date and time (dateTime), as Power BI types it.
            schema[c.get("sourceColumn", c["name"])] = pl.Datetime if dt == "dateTime" else TYPES.get(dt, pl.String)
        ctx.register(f"{name}__{source['entityName']}", pl.read_csv(path, schema_overrides=schema, infer_schema_length=10000))
    return ctx


def value(v):
    # As the DuckDB adapter writes one: a date as YYYY-MM-DD, a date and time as YYYY-MM-DD
    # HH:MM:SS (midnight as the date alone), a decimal as a number.
    if isinstance(v, datetime.datetime):
        # isoformat: a year below 1000 in four digits (strftime's %Y has none on Linux).
        return v.date().isoformat() if v.time() == datetime.time() else v.replace(microsecond=0).isoformat(sep=" ")
    if isinstance(v, datetime.date):
        return v.isoformat()
    if isinstance(v, decimal.Decimal):
        return float(v)
    # Infinity and NaN: JSON has neither (the DuckDB adapter's are written null too).
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return v


def main():
    ctx = load(sys.argv[1], sys.argv[2])
    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        q = json.loads(line)
        try:
            out = {"rows": [[value(v) for v in r] for r in ctx.execute(q["sql"], eager=True).rows()]}
        except BaseException as e:  # noqa: BLE001
            out = {"error": f"{type(e).__name__}: " + (str(e).splitlines()[0][:300] if str(e) else "")}
        print(json.dumps(out, default=str), flush=True)


if __name__ == "__main__":
    main()
