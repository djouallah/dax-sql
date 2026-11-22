# Apache Ossie's view expander (ost/src/ossie_ost/expander.py, on its main) as a filter, for
# formats/test/ossie-expand.mjs: each line of stdin a JSON object, each line of stdout its answer.
#   {"model": "<name>", "yaml": "<Ossie YAML>"}   defines a model (answer {"ok": true} or {"error"})
#   {"sql": "<query>"}                             expands a query (answer {"sql"} or {"error"})
# Run in the expander's project: uv run --project <ossie>/ost python formats/test/ossie_expand.py
import json
import sys

from ossie_ost.expander import Catalog, expand

sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
catalog = Catalog()
for line in sys.stdin:
    if not line.strip():
        continue
    req = json.loads(line)
    try:
        if "model" in req:
            catalog.add_model(req["model"], req["yaml"])
            out = {"ok": True}
        else:
            out = {"sql": expand(req["sql"], catalog)}
    except Exception as e:  # noqa: BLE001 - every failure is an answer
        out = {"error": f"{type(e).__name__}: {str(e).splitlines()[0] if str(e) else ''}"}
    sys.stdout.write(json.dumps(out) + "\n")
    sys.stdout.flush()
