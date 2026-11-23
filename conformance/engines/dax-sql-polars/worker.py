# A model's data in a Polars SQLContext, answering SQL one query at a time, for probe.mjs.
#   python worker.py <model dir> <name>
# Each table of the model.bim read from data/<entity>.csv with the bim's types, registered as
# <name>__<entity>. Prints {"ready": true}, then reads one JSON {"sql"} per line and answers each
# with one JSON line: {"rows": [...]} or {"error": "<class>: <first line>"}.
import json
import re
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
        with open(path, encoding="utf-8") as f:
            text = f.read()
        timestamps = re.search(r"\d{4}-\d\d-\d\d[ T]\d", text) is not None
        schema = {}
        for c in t["columns"]:
            if c.get("type") not in (None, "data"):
                continue
            dt = c["dataType"]
            schema[c.get("sourceColumn", c["name"])] = (pl.Datetime if timestamps else pl.Date) if dt == "dateTime" else TYPES.get(dt, pl.String)
        ctx.register(f"{name}__{source['entityName']}", pl.read_csv(path, schema_overrides=schema, infer_schema_length=10000))
    return ctx


def main():
    ctx = load(sys.argv[1], sys.argv[2])
    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        q = json.loads(line)
        try:
            out = {"rows": ctx.execute(q["sql"], eager=True).rows()}
        except BaseException as e:  # noqa: BLE001
            out = {"error": f"{type(e).__name__}: " + (str(e).splitlines()[0][:300] if str(e) else "")}
        print(json.dumps(out, default=str), flush=True)


if __name__ == "__main__":
    main()
