// The Apache Ossie documents dax-sql writes, for Ossie's own tools to check (.github/workflows/ossie.yml):
//   node formats/test/ossie-docs.mjs <out> <ossie checkout> [--formats <dir>]
// <out>/models: tmslToOssie of every model here (conformance/models, test/fixtures/contoso.js), as
//   it is and with each table named in full (lake.dbo.<table>, as OneLake Studio writes the copy of
//   a Direct Lake model), and the ossie.yaml files the repo keeps.
// <out>/portability: each fixture of Ossie's portability ladder (compliance/portability) read
//   (ossieToTmsl) and written back (tmslToOssie), and `list`, a line per fixture: its file, then
//   ours. A fixture dax-sql refuses is written back as {}, which the grader reads as REJECTED.
// --formats: the formats/ of a published dax-sql to check instead of this checkout's.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import { bim as contoso } from '../../test/fixtures/contoso.js';

const [out, ossie] = process.argv.slice(2);
if (!out || !ossie) throw new Error('usage: ossie-docs.mjs <out> <ossie checkout> [--formats <dir>]');
const at = process.argv.indexOf('--formats');
const formats = at > 0 ? resolve(process.argv[at + 1]) : fileURLToPath(new URL('..', import.meta.url));
const { tmslToOssie, ossieToTmsl } = await import(pathToFileURL(join(formats, 'ossie.js')).href);

const repo = new URL('../../', import.meta.url);
const read = p => readFileSync(new URL(p, repo), 'utf8').replace(/^﻿/, '');
const write = (p, doc) => writeFileSync(p, typeof doc === 'string' ? doc : stringify(doc, { lineWidth: 0 }));

const models = join(out, 'models');
mkdirSync(models, { recursive: true });
const bims = [['contoso', contoso], ...readdirSync(new URL('conformance/models/', repo))
  .filter(m => existsSync(new URL(`conformance/models/${m}/model.bim`, repo)))
  .map(m => [m, JSON.parse(read(`conformance/models/${m}/model.bim`))])];
for (const [name, bim] of bims) {
  write(join(models, `${name}.yaml`), tmslToOssie(bim, name));
  write(join(models, `${name}.named.yaml`), tmslToOssie(bim, name, { source: t => `lake.dbo.${t.name}` }));
}
// The files kept here, unless a published dax-sql is checked: they are this checkout's.
if (at < 0) {
  write(join(models, 'aac.kept.yaml'), read('conformance/models/aac/ossie.yaml'));
  write(join(models, 'aac.tools.yaml'), read('conformance/tools/aac/ossie.yaml'));
}

const ladder = join(ossie, 'compliance', 'portability');
const back = join(out, 'portability');
mkdirSync(back, { recursive: true });
const list = [];
for (const rung of parse(readFileSync(join(ladder, 'manifest.yaml'), 'utf8')).rungs) {
  for (const v of rung.variants) {
    const input = join(ladder, v.file);
    const returned = join(back, basename(v.file));
    const doc = parse(readFileSync(input, 'utf8'));
    try {
      write(returned, tmslToOssie(ossieToTmsl(doc), doc.name));
    } catch (e) {
      console.log(`${v.id}: refused, ${e.message}`);
      write(returned, {});
    }
    list.push(`${input}\t${returned}`);
  }
}
write(join(back, 'list'), list.join('\n') + '\n');
console.log(`${bims.length * 2} models, ${list.length} portability fixtures, in ${out}`);
