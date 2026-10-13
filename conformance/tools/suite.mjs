// The suite as files: models/<model>/ (model.bim, data/<Table>.csv), queries/<model>/<family>/<id>.dax,
// golden/<model>/<family>.json. Shared by the runner and the oracle's export.
//
// A query file is DAX, with optional header comments:
//   // note: what the query tests
//   // roles: France, Bikes
// A query's hash covers what its golden depends on: its text and roles, its model's structure
// and data, and the model's measures it reaches. A golden with another hash is stale.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sha = s => createHash('sha1').update(s).digest('hex');
const dirs = p => (existsSync(p) ? readdirSync(p, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort() : []);

export const modelDir = model => join(ROOT, 'models', model);
export const readBim = model => JSON.parse(readFileSync(join(modelDir(model), 'model.bim'), 'utf8'));

function modelInfo(model) {
  const bim = readBim(model);
  const measures = new Map();
  for (const t of bim.model.tables) for (const m of t.measures ?? []) measures.set(m.name.toLowerCase(), m.expression);
  const dataDir = join(modelDir(model), 'data');
  const data = readdirSync(dataDir).sort().map(f => f + readFileSync(join(dataDir, f), 'utf8')).join('\n');
  const tables = bim.model.tables.map(t => ({ ...t, measures: undefined }));
  const structure = sha(JSON.stringify({ ...bim, model: { ...bim.model, tables } }) + data);
  return { measures, structure };
}

// The measures a text names, and those they name, as [name, expression].
function closure(measures, text) {
  const seen = new Map(), todo = [text];
  while (todo.length) {
    for (const [, name] of todo.pop().matchAll(/\[([^\]]+)\]/g)) {
      const key = name.toLowerCase(), expr = measures.get(key);
      if (expr != null && !seen.has(key)) { seen.set(key, expr); todo.push(expr); }
    }
  }
  return [...seen].sort(([a], [b]) => (a < b ? -1 : 1));
}

export function parseQuery(text) {
  const header = {};
  for (const line of text.split('\n')) {
    const m = /^\s*\/\/\s*(note|roles|expect)\s*:\s*(.*?)\s*$/i.exec(line);
    if (m) header[m[1].toLowerCase()] = m[2];
    else if (line.trim() && !/^\s*\/\//.test(line)) break;
  }
  const roles = header.roles ? header.roles.split(',').map(s => s.trim()).filter(Boolean) : null;
  return { note: header.note ?? '', roles, expect: header.expect?.toLowerCase() || null };
}

export function loadQueries({ model: only } = {}) {
  const out = [];
  for (const model of dirs(join(ROOT, 'queries'))) {
    if (only && model !== only) continue;
    const info = modelInfo(model);
    for (const family of dirs(join(ROOT, 'queries', model))) {
      const dir = join(ROOT, 'queries', model, family);
      for (const file of readdirSync(dir).filter(f => f.endsWith('.dax')).sort()) {
        const dax = readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n');
        const { note, roles, expect } = parseQuery(dax);
        const hash = sha(JSON.stringify([info.structure, dax, roles, closure(info.measures, dax)]));
        out.push({ model, family, id: file.slice(0, -4), dax, note, roles, expect, hash });
      }
    }
  }
  return out;
}

export function loadGoldens(model, family) {
  const file = join(ROOT, 'golden', model, `${family}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}
