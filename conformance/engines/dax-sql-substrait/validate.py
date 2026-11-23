# The official Substrait validator (substrait-validator) over every plan export.mjs wrote:
# each plan's verdict (check_plan: 1 valid, -1 invalid, 0 undetermined) and its diagnostics,
# to <out>/validation.json, and a summary on stdout.
#
#   python conformance/engines/dax-sql-substrait/validate.py <plans folder>
import json
import os
import sys

import substrait_validator as sv

VERDICT = {1: 'valid', -1: 'invalid', 0: 'undetermined'}


def verdict(path):
    try:
        plan = sv.load_plan_from_json(open(path, encoding='utf-8').read())
        v = sv.check_plan(plan)
        # The errors and warnings: one line each, the info lines left out.
        text = sv.plan_to_diagnostics_str(plan)
        lines = [' '.join(l.split()) for l in text.splitlines() if l.strip() and 'Info' not in l.split(' ')[0:2]]
        return {'verdict': VERDICT.get(v, str(v)), 'diagnostics': lines[:30]}
    except Exception as err:  # a plan the validator cannot read at all
        return {'verdict': 'unreadable', 'diagnostics': [' '.join(str(err).split())[:400]]}


def main():
    folder = sys.argv[1]
    print('substrait-validator', sv.version() if callable(getattr(sv, 'version', None)) else '', 'for Substrait', sv.substrait_version() if callable(getattr(sv, 'substrait_version', None)) else '')
    out = {}
    for base, _, files in os.walk(folder):
        for f in files:
            if f.endswith('.json') and f not in ('dax.json', 'refused.json', 'validation.json'):
                path = os.path.join(base, f)
                out[os.path.relpath(path, folder).replace(os.sep, '/')[:-5]] = verdict(path)
    json.dump(out, open(os.path.join(folder, 'validation.json'), 'w'), indent=1)
    counts = {}
    for v in out.values():
        counts[v['verdict']] = counts.get(v['verdict'], 0) + 1
    print(f'{len(out)} plans:', ', '.join(f'{n} {k}' for k, n in sorted(counts.items())))


main()
