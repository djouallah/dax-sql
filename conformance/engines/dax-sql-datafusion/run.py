# Runs SQL on DataFusion: jobs.json { models: { name: { table: parquet } },
# queries: [{ id, model, sql }] } -> one JSON line per query: { id, rows, ms } or { id, error }.
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


# A query has DATAFUSION_TIMEOUT seconds (60): one past it is answered as timed out and the
# process ends (DataFusion's run cannot be stopped), exit code 3; the adapter runs the rest again.
TIMEOUT = float(os.environ.get('DATAFUSION_TIMEOUT') or 60)
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
                    # Its name as it is (the SQL quotes it: DataFusion lowercases a name that is not).
                    ctx.register_parquet(name, path)
                contexts[m] = ctx
            ctx = contexts[m]
            t0 = time.monotonic()
            table = ctx.sql(q['sql']).to_arrow_table()
            ms = round((time.monotonic() - t0) * 1000)
            cols = [table.column(i).to_pylist() for i in range(table.num_columns)]
            rows = [[value(c[r]) for c in cols] for r in range(table.num_rows)]
            print(json.dumps({'id': q['id'], 'rows': rows, 'ms': ms}), flush=True)
        # One query's failure is its answer, a panic of DataFusion's too (pyo3's PanicException
        # is a BaseException).
        except (KeyboardInterrupt, SystemExit):
            raise
        except BaseException as err:
            print(json.dumps({'id': q['id'], 'error': ' '.join(str(err).split())[:700]}), flush=True)
        current['id'] = None


main()
