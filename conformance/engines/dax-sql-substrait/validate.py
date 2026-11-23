# The official Substrait validator (substrait-validator) over every plan export.mjs wrote:
# each plan's verdict and its diagnostics, to <out>/validation.json, and a summary on stdout.
#
#   python conformance/engines/dax-sql-substrait/validate.py <plans folder>
import json
import os
import sys

import substrait_validator as sv


def verdict(path):
    data = open(path, 'rb').read()
    try:
        result = sv.check_plan(data, sv.Config()) if hasattr(sv, 'check_plan') else None
    except Exception as err:  # a plan the validator cannot read at all
        return {'valid': False, 'diagnostics': [' '.join(str(err).split())[:400]]}
    if result is None:
        raise SystemExit('substrait_validator has no check_plan: ' + ', '.join(n for n in dir(sv) if not n.startswith('_')))
    # Its diagnostics: errors and warnings, as text.
    lines = []
    for name in ('export_diagnostics', 'diagnostics'):
        f = getattr(result, name, None)
        if f:
            d = f() if callable(f) else f
            lines = [' '.join(str(x).split()) for x in (d.splitlines() if isinstance(d, str) else d)]
            break
    valid = None
    for name in ('check', 'valid', 'is_valid'):
        f = getattr(result, name, None)
        if f is not None:
            try:
                v = f() if callable(f) else f
                valid = True if v is None else bool(v) if not isinstance(v, int) else v >= 0
            except Exception as err:
                valid = False
                lines = lines or [' '.join(str(err).split())[:400]]
            break
    return {'valid': valid, 'diagnostics': lines[:20]}


def main():
    folder = sys.argv[1]
    out = {}
    for base, _, files in os.walk(folder):
        for f in files:
            if f.endswith('.json') and f not in ('dax.json', 'refused.json', 'validation.json'):
                path = os.path.join(base, f)
                out[os.path.relpath(path, folder).replace(os.sep, '/')[:-5]] = verdict(path)
    json.dump(out, open(os.path.join(folder, 'validation.json'), 'w'), indent=1)
    valid = sum(1 for v in out.values() if v['valid'])
    print(f'{valid} of {len(out)} plans valid')


main()
