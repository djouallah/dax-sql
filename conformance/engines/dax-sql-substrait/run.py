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


# DataFusion's consumer reads its own names for some of Substrait's functions, and no enum
# argument: the plan as DataFusion reads it (the plan itself stays Substrait's).
RENAME = {'sign': 'signum', 'std_dev': 'stddev', 'variance': 'var_samp', 'day_of_week': 'date_part'}


def for_datafusion(plan):
    names = {}
    for e in plan.get('extensions', []):
        f = e.get('extensionFunction')
        if f:
            names[f.get('functionAnchor', 0)] = f['name']
            if f['name'] in RENAME:
                f['name'] = RENAME[f['name']]
            elif f['name'] == 'extract':
                f['name'] = 'date_part'

    def walk(x):
        if isinstance(x, dict):
            f = x.get('scalarFunction')
            if f is not None:
                name = names.get(f.get('functionReference', 0))
                args = f.get('arguments', [])
                if name == 'extract' and args and 'enum' in args[0]:
                    args[0] = {'value': {'literal': {'string': args[0]['enum'].lower()}}}
                elif name == 'day_of_week':
                    f['arguments'] = [{'value': {'literal': {'string': 'dow'}}}] + args
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)

    walk(plan)
    return plan


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
            plan = ss.Plan.from_json(json.dumps(for_datafusion(json.load(open(q['plan'], encoding='utf-8')))))
            df = ctx.create_dataframe_from_logical_plan(ss.Consumer.from_substrait_plan(ctx, plan))
            table = df.to_arrow_table()
            cols = [table.column(i).to_pylist() for i in range(table.num_columns)]
            rows = [[value(c[r]) for c in cols] for r in range(table.num_rows)]
            print(json.dumps({'id': q['id'], 'rows': rows}), flush=True)
        except Exception as err:  # one query's failure is its answer
            print(json.dumps({'id': q['id'], 'error': str(err).split('\n')[0][:400]}), flush=True)


main()
