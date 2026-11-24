// What a run covered of src/, from c8's json-summary (c8 --reporter=json-summary): the total,
// and each file by its lines covered, least first, as markdown (to the step summary in CI).
//   node conformance/tools/coverage.mjs <coverage-summary.json> <title>
import { readFileSync, appendFileSync } from 'node:fs';
import { relative, sep } from 'node:path';

const [file, title = 'Coverage'] = process.argv.slice(2);
const s = JSON.parse(readFileSync(file, 'utf8'));
const pct = m => `${m.pct.toFixed(1)}% (${m.covered}/${m.total})`;
const files = Object.entries(s).filter(([k]) => k !== 'total')
  .map(([k, v]) => ({ name: relative(process.cwd(), k).split(sep).join('/'), ...v }))
  .sort((a, b) => a.lines.pct - b.lines.pct);
const out = [
  `### ${title}`, '',
  `Lines ${pct(s.total.lines)}, branches ${pct(s.total.branches)}, functions ${pct(s.total.functions)}.`, '',
  '| file | lines | branches | functions |', '|---|---|---|---|',
  ...files.map(f => `| ${f.name} | ${pct(f.lines)} | ${pct(f.branches)} | ${pct(f.functions)} |`), '',
].join('\n');
console.log(out);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + '\n');
