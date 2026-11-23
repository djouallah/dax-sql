# Runs Substrait plans on DataFusion: jobs.json { models: { name: { table: parquet } },
# queries: [{ id, model, plan }] } -> one JSON line per query: { id, rows } or { id, error }.
# Values as the suite's answers hold them: a date as YYYY-MM-DD, a date and time to the second
# (at midnight, the date alone), a decimal as a number.
import datetime
import decimal
import json
import sys

from datafusion import SessionContext
from datafusion import substrait as ss


def value(v):
    if isinstance(v, datetime.datetime):
        return v.date().isoformat() if v.time() == datetime.time(0) else v.strftime('%Y-%m-%d %H:%M:%S')
    if isinstance(v, datetime.date):
        return v.isoformat()
    if isinstance(v, decimal.Decimal):
        return float(v)
    return v


def main():
    jobs = json.load(open(sys.argv[1], encoding='utf-8'))
    contexts = {}
    for q in jobs['queries']:
        try:
            m = q['model']
            if m not in contexts:
                ctx = SessionContext()
                for name, path in jobs['models'][m].items():
                    # Quoted: DataFusion lowercases a name that is not (the plan reads 'Product').
                    ctx.register_parquet('"' + name.replace('"', '""') + '"', path)
                contexts[m] = ctx
            ctx = contexts[m]
            plan = ss.Plan.from_json(open(q['plan'], encoding='utf-8').read())
            df = ctx.create_dataframe_from_logical_plan(ss.Consumer.from_substrait_plan(ctx, plan))
            table = df.to_arrow_table()
            cols = [table.column(i).to_pylist() for i in range(table.num_columns)]
            rows = [[value(c[r]) for c in cols] for r in range(table.num_rows)]
            print(json.dumps({'id': q['id'], 'rows': rows}), flush=True)
        except Exception as err:  # one query's failure is its answer
            print(json.dumps({'id': q['id'], 'error': str(err).split('\n')[0][:400]}), flush=True)


main()
