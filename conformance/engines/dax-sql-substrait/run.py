# Runs Substrait plans on DataFusion: jobs.json { models: { name: { table: parquet } },
# queries: [{ id, model, plan }] } -> one JSON line per query: { id, rows } or { id, error }.
# Values as the suite's answers hold them: a date as YYYY-MM-DD, a date and time to the second
# (at midnight, the date alone), a decimal as a number.
import datetime
import decimal
import json
import os
import sys
import threading
import time

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
RENAME = {'sign': 'signum', 'std_dev': 'stddev', 'variance': 'var_samp', 'extract': 'date_part', 'round_calendar': 'date_trunc'}
# extract's component as date_part's unit (indexing ONE is date_part's own, but the day of the
# week from Sunday, which date_part counts from 0).
UNIT = {'DAY_OF_YEAR': 'doy', 'MONDAY_DAY_OF_WEEK': 'isodow'}


def for_datafusion(plan):
    names = {}
    for e in plan.get('extensions', []):
        f = e.get('extensionFunction')
        if f:
            names[f.get('functionAnchor', 0)] = f['name']
            f['name'] = RENAME.get(f['name'], f['name'])

    def text(v):
        return {'value': {'literal': {'string': v}}}

    def walk(x):
        if isinstance(x, dict):
            f = x.get('scalarFunction')
            if f is not None:
                name = names.get(f.get('functionReference', 0))
                args = f.get('arguments', [])
                if name == 'extract':
                    enums = [a['enum'] for a in args if 'enum' in a]
                    value = [a for a in args if 'value' in a]
                    component = enums[0]
                    unit = 'dow' if component == 'SUNDAY_DAY_OF_WEEK' else UNIT.get(component, component.lower())
                    f['arguments'] = [text(unit)] + value
                    if component == 'SUNDAY_DAY_OF_WEEK' and enums[1:] == ['ONE']:
                        raise ValueError('extract SUNDAY_DAY_OF_WEEK indexed from one')
                elif name == 'round_calendar':
                    x_, _rounding, unit, _origin, multiple = args
                    n = int(multiple['value']['literal']['i64'])
                    f['arguments'] = [text('quarter' if unit['enum'] == 'MONTH' and n == 3 else unit['enum'].lower()), x_]
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)

    walk(plan)
    return plan


# A query has SUBSTRAIT_TIMEOUT seconds (60): one past it is answered as timed out and the
# process ends (DataFusion's run cannot be stopped), exit code 3; the adapter runs the rest again.
TIMEOUT = float(os.environ.get('SUBSTRAIT_TIMEOUT') or 60)
current = {'id': None, 'since': 0.0}


def watchdog():
    while True:
        time.sleep(1)
        q = current['id']
        if q is not None and time.monotonic() - current['since'] > TIMEOUT:
            print(json.dumps({'id': q, 'error': f'timeout: no answer from DataFusion in {TIMEOUT:g} s'}), flush=True)
            os._exit(3)


def main():
    jobs = json.load(open(sys.argv[1], encoding='utf-8'))
    contexts = {}
    threading.Thread(target=watchdog, daemon=True).start()
    for q in jobs['queries']:
        current['id'], current['since'] = q['id'], time.monotonic()
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
        # One query's failure is its answer, a panic of DataFusion's too (pyo3's PanicException
        # is a BaseException).
        except (KeyboardInterrupt, SystemExit):
            raise
        except BaseException as err:
            print(json.dumps({'id': q['id'], 'error': ' '.join(str(err).split())[:700]}), flush=True)
        current['id'] = None


main()
