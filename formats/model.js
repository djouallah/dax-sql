// A model's file, or a folder of them, as TMSL, by the reader of its format: what a host does
// before createCompiler, in one place. Not part of the compiler: a reader of files.
//   import { readModel } from 'dax-sql/formats/model.js';
//   const { bim, skipped } = readModel('sales.bim', text);
//   const { bim, skipped } = readModel('Semantic Views/nem', { 'model.yaml': text, ... }, { parseYaml });
//   createCompiler(tmslToModel(bim), options)
//
// The format is the path's: `.bim` TMSL (JSON), `.tmdl` TMDL, `.yaml` / `.yml` Apache Ossie. A
// folder is `{ path: text }`: TMDL when it holds .tmdl files (those are read), else Apache Ossie,
// its .yaml files merged as Fabric merges a semantic view's (ossie.js, ossieFolder; a .yml beside
// them is not read). A UTF-8 BOM before a file's text is dropped (Visual Studio writes one).
// YAML is parsed by `parseYaml`, the caller's (dax-sql has no dependencies): it is needed for
// Ossie only, as are `catalog` and `columnsOf` (ossieToTmsl's: what a Fabric semantic view leaves to
// the platform) and `as: 'fabric'` (a Fabric semantic view read as Fabric's Publish reads it,
// leniently: ossieToTmsl's). `skipped` is what ossieToTmsl left out ({ kind, name, dataset, why }); a model
// whose metrics were all left out is refused (but a Fabric view's). Every error is a DaxError of code INPUT naming the
// file.
import { DaxError } from '../src/errors.js';
import { tmdlToTmsl } from './tmdl.js';
import { ossieToTmsl } from './ossie.js';

const FORMATS = 'a .bim (TMSL), a .tmdl or a folder of them (TMDL), or a .yaml / .yml or a folder of .yaml files (Apache Ossie)';
const bad = msg => new DaxError(msg, { code: 'INPUT' });
const noBom = t => String(t).replace(/^﻿/, '');

// A model file's format from its path and text, with nothing parsed (a host sniffs before it
// reads): 'tmsl', 'tmdl', 'ossie', or null when it is no model:
//   .bim, or JSON with a "model" key            'tmsl'
//   .yaml / .yml with a top-level datasets: and version:   'ossie' (a dbt schema.yml, a pipeline's
//     config: null, a document)
//   .tmdl of a whole model: createOrReplace, database or model, and its tables   'tmdl' (one file of
//     a Power BI project's definition/ folder, a table or the model's settings alone: null)
// Any other path is told by the same tests of its text.
export function formatOf(path, text) {
  const p = String(path ?? ''), t = noBom(text ?? '');
  const json = () => /^\s*\{/.test(t) && /"model"\s*:/.test(t);
  const ossie = () => /^datasets\s*:/m.test(t) && /^version\s*:/m.test(t);
  const tmdl = () => /^\s*(createOrReplace|database|model)\b/m.test(t) && /^\s*table\s/m.test(t);
  if (/\.bim$/i.test(p)) return 'tmsl';
  if (/\.ya?ml$/i.test(p)) return ossie() ? 'ossie' : null;
  if (/\.tmdl$/i.test(p)) return tmdl() ? 'tmdl' : null;
  return json() ? 'tmsl' : ossie() ? 'ossie' : tmdl() ? 'tmdl' : null;
}

export function readModel(path, input, { parseYaml, catalog, columnsOf, as } = {}) {
  path = String(path ?? '');
  if (parseYaml != null && typeof parseYaml !== 'function') throw bad('readModel: parseYaml is a function (text -> document)');
  // A reader's error, its own code kept (INPUT from a folder's merge), any other as INPUT.
  const read = (what, f) => {
    try { return f(); } catch (e) {
      if (e instanceof DaxError) throw e;
      throw bad(`${path} is not ${what}: ${e.message}`);
    }
  };
  const yaml = (file, text) => {
    if (!parseYaml) throw bad(`${file}: an Apache Ossie model is YAML, which readModel parses with the caller's parseYaml`);
    try { return parseYaml(noBom(text)); } catch (e) { throw bad(`${file} is not YAML: ${e.message}`); }
  };
  const ossie = doc => {
    const skipped = [];
    const bim = ossieToTmsl(doc, { onSkip: s => skipped.push(s), catalog, columnsOf, as });
    // A Fabric view opens without what Publish leaves out, its metrics too.
    if (as === 'fabric') return { bim, skipped };
    const measures = (bim.model?.tables ?? []).reduce((n, t) => n + (t.measures?.length ?? 0), 0);
    const metrics = skipped.filter(s => s.kind === 'metric');
    if (!measures && metrics.length) throw bad(`${path}: none of its metrics can be read: ${metrics.map(s => s.why).join('; ')}`);
    return { bim, skipped };
  };

  if (typeof input === 'string') {
    const body = noBom(input);
    // By its extension, else by its text (formatOf).
    const kind = /\.bim$/i.test(path) ? 'tmsl' : /\.tmdl$/i.test(path) ? 'tmdl' : /\.ya?ml$/i.test(path) ? 'ossie' : formatOf(path, body);
    if (kind === 'tmsl') return { bim: read('a TMSL model', () => JSON.parse(body)), skipped: [] };
    if (kind === 'tmdl') {
      if (!formatOf('.tmdl', body)) throw bad(`${path} is one file of a Power BI project, not a model: read its definition folder`);
      return { bim: read('a TMDL model', () => tmdlToTmsl(body)), skipped: [] };
    }
    if (kind === 'ossie') {
      const doc = yaml(path, body);
      if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !Array.isArray(doc.datasets)) throw bad(`${path} is not an Apache Ossie model: YAML with no datasets`);
      return read('an Apache Ossie model', () => ossie(as === 'fabric' && /.yaml$/i.test(path) ? { [path]: doc } : doc));
    }
    throw bad(`${path}: a model is read from ${FORMATS}`);
  }
  if (input === null || typeof input !== 'object' || Array.isArray(input) || !Object.values(input).every(v => typeof v === 'string')) {
    throw bad(`${path}: a model is a file's text, or a folder of files as { path: text }`);
  }
  const files = Object.entries(input);
  const tmdl = files.filter(([p]) => /\.tmdl$/i.test(p));
  if (tmdl.length) return { bim: read('a TMDL model', () => tmdlToTmsl(Object.fromEntries(tmdl.map(([p, t]) => [p, noBom(t)])))), skipped: [] };
  const yamls = files.filter(([p]) => /\.yaml$/i.test(p));
  if (!yamls.length) throw bad(`${path}: the folder has no .tmdl or .yaml file`);
  const docs = Object.fromEntries(yamls.map(([p, t]) => [p, yaml(p, t)]));
  return read('a folder of Apache Ossie files', () => ossie(docs));
}
