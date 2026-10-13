"""Ask Power BI the suite's queries: its answers are the goldens every engine is held to.

    node oracle/export.mjs out
    WS_ID=... ADOMD_DIR=... POWERBI_TOKEN=... PYTHONNET_RUNTIME=coreclr python oracle/oracle.py out [--all] [--no-publish]

1. Publishes each model of out/ (an Import model whose tables are M #table literals) to the
   workspace with fabric-cicd, and refreshes it. It has no data source, so the refresh needs
   no credentials.
2. Asks it, over XMLA (ADOMD.NET under pythonnet), every query whose golden is missing or stale
   (its hash is not the query's), or every query with --all. A query with roles is asked on a
   connection with those roles.
3. Writes golden/<model>/<family>.json: by id, { hash, columns, rows } or { hash, error }.
   Goldens of queries no longer in the suite are dropped.

Needs `az login` as an identity that can create items in the workspace (fabric-cicd), and
POWERBI_TOKEN, a token for https://analysis.windows.net/powerbi/api (REST and XMLA).
"""

import glob
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api.powerbi.com/v1.0/myorg"
REPO = Path(__file__).resolve().parent.parent
GOLDEN = REPO / "golden"


def call(method, path, body=None):
    """(status, parsed body). An HTTP error is an answer too: its body says why."""
    req = urllib.request.Request(f"{API}{path}", method=method,
                                 data=None if body is None else json.dumps(body).encode(),
                                 headers={"Authorization": f"Bearer {os.environ['POWERBI_TOKEN']}",
                                          "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            status, raw = r.status, r.read()
    except urllib.error.HTTPError as e:
        status, raw = e.code, e.read()
    try:
        return status, json.loads(raw) if raw else None
    except ValueError:
        return status, raw.decode(errors="replace")


def publish(out):
    from azure.identity import AzureCliCredential
    from fabric_cicd import FabricWorkspace, publish_all_items

    publish_all_items(FabricWorkspace(
        workspace_id=os.environ["WS_ID"],
        repository_directory=str(Path(out).resolve()),
        item_type_in_scope=["SemanticModel"],
        token_credential=AzureCliCredential(),
    ))


def refresh(base):
    status, body = call("POST", f"{base}/refreshes", {"notifyOption": "NoNotification"})
    print(f"refresh requested: {status} {body or ''}", flush=True)
    if status not in (200, 202):
        sys.exit(1)
    last = {}
    for _ in range(120):
        time.sleep(5)
        status, body = call("GET", f"{base}/refreshes?$top=1")
        last = (body or {}).get("value", [{}])[0] if status == 200 else {}
        if last.get("status") not in (None, "Unknown"):
            break
    print(f"refresh: {json.dumps(last)}", flush=True)
    if last.get("status") != "Completed":
        sys.exit(1)


def connect(workspace_name, model, roles=None):
    """An XMLA connection to the model; with roles, as a member of them."""
    import clr  # pythonnet

    hits = glob.glob(os.path.join(os.environ["ADOMD_DIR"], "**", "Microsoft.AnalysisServices.AdomdClient.dll"),
                     recursive=True)
    if not hits:
        sys.exit(f"no Microsoft.AnalysisServices.AdomdClient.dll under {os.environ['ADOMD_DIR']}")
    sys.path.append(os.path.dirname(hits[0]))
    clr.AddReference("Microsoft.AnalysisServices.AdomdClient")
    from Microsoft.AnalysisServices.AdomdClient import AdomdConnection

    base = (f"Data Source=powerbi://api.powerbi.com/v1.0/myorg/{workspace_name};"
            f"Initial Catalog={model};User ID=;Password={os.environ['POWERBI_TOKEN']};")
    # Roles apply only to a member of them: the oracle publishes its app as a member of every role.
    conn = AdomdConnection(base + (f"Roles={','.join(roles)};" if roles else ""))
    conn.Open()
    return conn


def value(v):
    """A cell as JSON, typed: numbers as numbers, a date as yyyy-MM-dd (with its time when it
    has one), a blank as null. pythonnet converts .NET's integers, doubles, booleans and strings
    itself; a Decimal (a Currency column) and a DateTime stay .NET objects."""
    from System.Globalization import CultureInfo

    kind = type(v).__name__
    if v is None or kind == "DBNull":
        return None
    if kind == "DateTime":
        return v.ToString("yyyy-MM-dd") if v.TimeOfDay.Ticks == 0 else v.ToString("yyyy-MM-dd HH:mm:ss")
    if isinstance(v, (bool, int, float, str)):
        return v
    if kind == "Decimal":
        return float(v.ToString(CultureInfo.InvariantCulture))
    return str(v)


def ask(conn, dax):
    from Microsoft.AnalysisServices.AdomdClient import AdomdCommand

    cmd = AdomdCommand(dax, conn)
    cmd.CommandTimeout = 300
    reader = cmd.ExecuteReader()
    try:
        columns = [reader.GetName(i) for i in range(reader.FieldCount)]
        rows = []
        while reader.Read():
            rows.append([value(reader.GetValue(i)) for i in range(reader.FieldCount)])
        return {"columns": columns, "rows": rows}
    finally:
        reader.Close()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    if not args:
        sys.exit(__doc__)
    out = Path(args[0])
    spec = json.loads((out / "queries.json").read_text(encoding="utf-8"))
    names, queries = spec["models"], spec["queries"]

    def golden_file(model, family):
        return GOLDEN / model / f"{family}.json"

    keys = {(q["model"], q["family"]) for q in queries} | {(p.parent.name, p.stem) for p in GOLDEN.glob("*/*.json")}
    goldens = {k: (json.loads(golden_file(*k).read_text(encoding="utf-8")) if golden_file(*k).exists() else {})
               for k in keys}
    # Asked again: a missing or stale golden, and an error, which may have been the oracle's own.
    def due(q):
        g = goldens[(q["model"], q["family"])].get(q["id"], {})
        return "--all" in flags or g.get("hash") != q["hash"] or "error" in g
    todo = [q for q in queries if due(q)]
    print(f"{len(queries)} queries, {len(todo)} to ask", flush=True)

    if todo and "--no-publish" not in flags:
        publish(out)

    workspace = os.environ["WS_ID"]
    status, body = call("GET", f"/groups?$filter={urllib.parse.quote(f'id eq {chr(39)}{workspace}{chr(39)}')}")
    workspace_name = (body or {}).get("value", [{}])[0].get("name") if status == 200 else None
    status, body = call("GET", f"/groups/{workspace}/datasets")
    datasets = {d["name"]: d for d in (body or {}).get("value", [])} if status == 200 else {}
    for model in sorted({q["model"] for q in todo}):
        if not workspace_name or names[model] not in datasets:
            sys.exit(f"no semantic model {names[model]} in workspace {workspace_name or workspace} ({status}): {body}")
        if "--no-publish" not in flags:
            refresh(f"/groups/{workspace}/datasets/{datasets[names[model]]['id']}")

    conns = {}
    for n, q in enumerate(todo, 1):
        key = (q["model"], tuple(q["roles"] or []))
        where = f"[{n}/{len(todo)}] {q['model']}/{q['family']}/{q['id']}"
        try:
            if key not in conns:
                conns[key] = connect(workspace_name, names[q["model"]], list(key[1]))
            answer = ask(conns[key], q["dax"])
            print(f"{where}: {len(answer['rows'])} rows", flush=True)
        except Exception as e:  # noqa: BLE001  (a .NET exception: its text is the evidence)
            text = str(e).strip()
            answer = {"error": (text.splitlines()[0] if text else type(e).__name__)[:1000]}
            print(f"{where}: ERROR {answer['error']}", flush=True)
        goldens[(q["model"], q["family"])][q["id"]] = {"hash": q["hash"], **answer}

    ids = {(q["model"], q["family"], q["id"]) for q in queries}
    for (model, family), entries in goldens.items():
        kept = {i: entries[i] for i in sorted(entries) if (model, family, i) in ids}
        path = golden_file(model, family)
        if kept:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(kept, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        elif path.exists():
            path.unlink()
    return 0


if __name__ == "__main__":
    sys.exit(main())
