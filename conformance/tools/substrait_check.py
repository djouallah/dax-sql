# Every plan read against the Substrait specification on main: each parsed as a Plan message
# with the protos of that commit (protobuf's JSON parser, no unknown field let through), and each
# extension function it declares one of the extension YAML file its URN names.
#   python substrait_check.py <substrait checkout> <plans dir>
import glob
import json
import os
import subprocess
import sys
import tempfile

import yaml

repo, plans = sys.argv[1], sys.argv[2]
out = tempfile.mkdtemp()
protos = glob.glob(f'{repo}/proto/substrait/**/*.proto', recursive=True)
subprocess.run([sys.executable, '-m', 'grpc_tools.protoc', f'-I{repo}/proto', f'--python_out={out}', *protos], check=True)
sys.path.insert(0, out)
from google.protobuf import json_format  # noqa: E402
from substrait import plan_pb2  # noqa: E402

# The names each extension file declares, by its URN.
names = {}
for f in glob.glob(f'{repo}/extensions/*.yaml'):
    y = yaml.safe_load(open(f, encoding='utf-8'))
    names[y.get('urn')] = {x['name'] for k in ('scalar_functions', 'aggregate_functions', 'window_functions', 'table_functions') for x in (y.get(k) or [])}

files = sorted(glob.glob(f'{plans}/*.json'))
bad, unknown = {}, {}
for p in files:
    text = open(p, encoding='utf-8').read()
    try:
        # (Nested past protobuf's default 100 levels: a 32-level PATH's joins.)
        json_format.Parse(text, plan_pb2.Plan(), max_recursion_depth=100000)
    except json_format.ParseError as e:
        bad.setdefault(str(e).split('\n')[0][:200], []).append(os.path.basename(p))
    plan = json.loads(text)
    urns = {u['extensionUrnAnchor']: u['urn'] for u in plan.get('extensionUrns', [])}
    for d in plan.get('extensions', []):
        f = d.get('extensionFunction')
        if f and f['name'] not in names.get(urns.get(f['extensionUrnReference']), set()):
            unknown.setdefault(f"{urns.get(f['extensionUrnReference'])}: {f['name']}", []).append(os.path.basename(p))

sha = subprocess.run(['git', '-C', repo, 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
lines = [f'### The plans as Substrait, against substrait-io/substrait main ({sha[:10]})', '',
         f'{len(files)} plans: {len(files) - sum(len(v) for v in bad.values())} parse as Substrait Plan messages; '
         f'{sum(len(v) for v in unknown.values())} declare a function their extension file does not have.', '']
for k, v in sorted(bad.items(), key=lambda kv: -len(kv[1]))[:20]:
    lines.append(f'- parse ({len(v)}): {k} (e.g. {v[0]})')
for k, v in sorted(unknown.items(), key=lambda kv: -len(kv[1]))[:20]:
    lines.append(f'- function ({len(v)}): {k} (e.g. {v[0]})')
print('\n'.join(lines))
if os.environ.get('GITHUB_STEP_SUMMARY'):
    open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8').write('\n'.join(lines) + '\n')
sys.exit(1 if bad or unknown else 0)
