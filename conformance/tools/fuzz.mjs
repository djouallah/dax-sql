// Random DAX queries over a model, for Power BI to answer (oracle.yml) and dax-sql to be held to:
// queries/<model>/<family>/<family>-NNNN.dax. Seeded, so the same seed writes the same queries;
// none is picked by hand, and none is changed after dax-sql has run it. The grammar is
// fuzz-grammar.mjs's: fuzz and fuzz2 its first, every family after them its extended one.
//   node conformance/tools/fuzz.mjs <model> <count> <seed> [family]   (family: fuzz)
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './suite.mjs';
import { generator } from './fuzz-grammar.mjs';

const [model, countArg, seedArg, familyArg] = process.argv.slice(2);
const COUNT = Number(countArg ?? 100), SEED = Number(seedArg ?? 1), FAMILY = familyArg ?? 'fuzz';
const g = generator(model, SEED, { extended: !['fuzz', 'fuzz2'].includes(FAMILY) });

const dir = join(ROOT, 'queries', model, FAMILY);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
for (let i = 1; i <= COUNT; i++) {
  const id = `${FAMILY}-${String(i).padStart(4, '0')}`;
  const { dax, roles } = g.query();
  writeFileSync(join(dir, `${id}.dax`), `// note: a random query (conformance/tools/fuzz.mjs ${model} ${COUNT} ${SEED} ${FAMILY}, number ${i})\n${roles ? `// roles: ${roles.join(', ')}\n` : ''}${dax}\n`);
}
console.log(`${COUNT} queries in ${dir}`);
