"""Writes the suite's data into a Fabric lakehouse as Delta tables, for the T-SQL adapter to query
on its SQL endpoint: real tables, run by Fabric's distributed engine as a model's would be.

    python engines/dax-sql-tsql/lakehouse.py [model ...]

Each model's tables go to schema `daxconf` as `<model>_<table>`, their columns under safe names
(c<i>_<name>; the adapter reads them back under the model's), with `<model>__data`: one row,
the hash of the model's model.bim and data/ the tables were written from. The adapter refuses
to run on tables whose hash is another (the data changed: write them again). A model whose
tables have this hash already is skipped.

The CSVs are read as the DuckDB adapter reads them (an empty field unquoted is NULL, "" is '').
The workspace and lakehouse: LAKEHOUSE_WS and LAKEHOUSE_ID (ids), the token the Azure CLI's
(az login) for OneLake and for Fabric's REST API, which refreshes the SQL endpoint's metadata
(LAKEHOUSE_SQL_ENDPOINT, its id) so the tables are there to query when this ends.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import duckdb
import pyarrow as pa
from deltalake import DeltaTable, write_deltalake

HERE = Path(__file__).resolve().parent
SUITE = HERE.parent.parent
WS = os.environ["LAKEHOUSE_WS"]
LH = os.environ["LAKEHOUSE_ID"]
ENDPOINT = os.environ.get("LAKEHOUSE_SQL_ENDPOINT")
SCHEMA = "daxconf"
DUCK = {"int64": "BIGINT", "double": "DOUBLE", "decimal": "DECIMAL(18,4)", "string": "VARCHAR", "boolean": "BOOLEAN"}


def token(resource):
    az = "az.cmd" if os.name == "nt" else "az"
    return subprocess.check_output([az, "account", "get-access-token", "--resource", resource, "--query", "accessToken", "-o", "tsv"], text=True).strip()


def safe(i, name):
    """A column's name in the Delta table: one SQL and Delta take as it is."""
    return f"c{i}_" + re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:40]


def data_hash(model_dir):
    """The hash of the CSVs (by name, in code point order) and then model.bim, each its name and
    its bytes: as the adapter computes it (dataHash)."""
    h = hashlib.sha256()
    files = sorted((model_dir / "data").glob("*.csv"), key=lambda f: f.name) + [model_dir / "model.bim"]
    for f in files:
        h.update(f.name.encode())
        h.update(f.read_bytes())
    return h.hexdigest()


def tables_of(model_dir):
    """(entity, [(column name, source column, TMSL type)]) of each table with data."""
    bim = json.loads((model_dir / "model.bim").read_text(encoding="utf-8-sig"))
    for t in bim["model"]["tables"]:
        source = (t.get("partitions") or [{}])[0].get("source", {})
        if source.get("type") != "entity":
            continue
        cols = [c for c in t["columns"] if not c.get("type") or c.get("type") == "data"]
        yield source["entityName"], [(c["name"], c.get("sourceColumn", c["name"]), c.get("dataType")) for c in cols]


def read_csv(con, file, cols):
    text = file.read_text(encoding="utf-8")
    dated = bool(re.search(r"\d{4}-\d\d-\d\d[ T]\d", text))
    def kind(t):
        if t != "dateTime":
            return DUCK.get(t, "VARCHAR")
        return "TIMESTAMP" if dated else "DATE"
    spec = ", ".join(f"'{s.replace(chr(39), chr(39) * 2)}': '{kind(t)}'" for _, s, t in cols)
    path = str(file).replace("'", "''")
    sel = ", ".join(f'"{s}" AS "{safe(i, s)}"' for i, (_, s, _) in enumerate(cols))
    rel = con.sql(f"SELECT {sel} FROM read_csv('{path}', header = true, columns = {{{spec}}}, nullstr = '', "
                  "allow_quoted_nulls = false, quote = '\"', escape = '\"')")
    table = rel.arrow()
    if hasattr(table, "read_all"):
        table = table.read_all()
    # Timestamps as Delta's `timestamp` (UTC), which the SQL endpoint reads as DATETIME2.
    fields = [pa.field(f.name, pa.timestamp("us", "UTC")) if pa.types.is_timestamp(f.type) else f for f in table.schema]
    return table.cast(pa.schema(fields))


def tables_url(name):
    return f"abfss://{WS}@onelake.dfs.fabric.microsoft.com/{LH}/Tables/{SCHEMA}/{name}"


def stored_hash(opts, model):
    try:
        t = DeltaTable(tables_url(f"{model}__data"), storage_options=opts).to_pyarrow_table()
        return t.column("hash")[0].as_py() if t.num_rows else None
    except Exception:
        return None


def refresh_endpoint(names, since):
    """The SQL endpoint's metadata refreshed until every table in `names` was synced after `since`
    (UTC, ISO): one refresh can leave a table it has not reached yet."""
    if not ENDPOINT:
        return
    url = f"https://api.fabric.microsoft.com/v1/workspaces/{WS}/sqlEndpoints/{ENDPOINT}/refreshMetadata"
    for attempt in range(20):
        req = urllib.request.Request(url, data=b"{}", method="POST",
                                     headers={"Authorization": f"Bearer {token('https://api.fabric.microsoft.com')}", "Content-Type": "application/json"})
        with urllib.request.urlopen(req) as r:
            body = r.read()
            where = r.headers.get("Location") if r.status == 202 else None
        while where:   # a long-running operation: its result once it ends
            time.sleep(5)
            with urllib.request.urlopen(urllib.request.Request(where, headers={"Authorization": f"Bearer {token('https://api.fabric.microsoft.com')}"})) as p:
                op = json.loads(p.read() or b"{}")
                if op.get("status") in ("Succeeded", "Failed"):
                    where = None
                    with urllib.request.urlopen(urllib.request.Request(where_result(p, op), headers={"Authorization": f"Bearer {token('https://api.fabric.microsoft.com')}"})) as res:
                        body = res.read()
        synced = {t["tableName"]: t.get("lastSuccessfulSyncDateTime") or "" for t in json.loads(body or b"{}").get("value", [])}
        failed = [t for t in json.loads(body or b"{}").get("value", []) if t.get("status") == "Failure" and t["tableName"] in names]
        if failed:
            raise RuntimeError(f"the SQL endpoint could not sync {failed}")
        late = [n for n in names if synced.get(n, "") < since]
        if not late:
            return
        print(f"waiting for the SQL endpoint: {len(late)} table(s) not synced yet")
        time.sleep(10)
    raise RuntimeError(f"the SQL endpoint did not sync {late}")


def where_result(p, op):
    return p.headers.get("Location") or op.get("resourceLocation")


def main(models):
    opts = {"bearer_token": token("https://storage.azure.com"), "use_fabric_endpoint": "true"}
    con = duckdb.connect()
    since = time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime())
    written = []
    for model in models:
        model_dir = SUITE / "models" / model
        h = data_hash(model_dir)
        if stored_hash(opts, model) == h:
            print(f"{model}: up to date")
            continue
        n = 0
        for entity, cols in tables_of(model_dir):
            file = model_dir / "data" / f"{entity}.csv"
            if not file.exists():
                raise SystemExit(f"no data for {entity}: {file}")
            table = read_csv(con, file, cols)
            write_deltalake(tables_url(f"{model}_{entity.lower()}"), table, mode="overwrite", schema_mode="overwrite", storage_options=opts)
            written.append(f"{SCHEMA}.{model}_{entity.lower()}")
            n += table.num_rows
        write_deltalake(tables_url(f"{model}__data"), pa.table({"hash": [h]}), mode="overwrite", schema_mode="overwrite", storage_options=opts)
        written.append(f"{SCHEMA}.{model}__data")
        print(f"{model}: {n} rows")
    if written:
        refresh_endpoint(written, since)


if __name__ == "__main__":
    main(sys.argv[1:] or sorted(p.name for p in (SUITE / "models").iterdir() if (p / "model.bim").exists()))
