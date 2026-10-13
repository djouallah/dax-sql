// What the oracle (oracle/oracle.py) needs, in a folder:
//   <out>/<name>.SemanticModel/  each model with its data inside, as a Fabric item (.platform,
//                                definition.pbism, model.bim): an Import model whose tables
//                                are M #table literals, so it refreshes with no data source
//                                and no credentials
//   <out>/queries.json           the deployed name of each model, and every query:
//                                { model, family, id, dax, roles, hash }
//
//   node oracle/export.mjs <out>
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadQueries, readBim, modelDir } from '../tools/suite.mjs';
import { parseCsv } from '../tools/csv.mjs';

const out = process.argv[2];
if (!out) throw new Error('usage: node oracle/export.mjs <out>');

const M_TYPE = { int64: 'Int64.Type', double: 'number', decimal: 'Currency.Type', string: 'text', dateTime: 'datetime', boolean: 'logical' };
const mValue = (v, type) => {
  if (v == null) return 'null';
  if (type === 'string') return `"${String(v).replace(/"/g, '""')}"`;
  if (type === 'dateTime') {
    const [, y, mo, d, h = 0, mi = 0, s = 0] = /^(\d+)-(\d+)-(\d+)(?:[ T](\d+):(\d+):(\d+))?/.exec(v).map(x => Number(x ?? 0));
    return `#datetime(${y},${mo},${d},${h},${mi},${s})`;
  }
  if (type === 'boolean') return v ? 'true' : 'false';
  return String(v);
};

function powerbiBim(model) {
  const bim = readBim(model);
  // Power BI applies roles over XMLA only to a member of them: the oracle's app is one of each.
  const { AZURE_CLIENT_ID: app, AZURE_TENANT_ID: tenant } = process.env;
  const member = { memberName: `app:${app}@${tenant}`, identityProvider: 'AzureAD' };
  if (app && tenant) for (const r of bim.model.roles ?? []) r.members = [member];
  for (const t of bim.model.tables) {
    const p = t.partitions?.[0];
    if (p?.source?.type !== 'entity') continue;
    const types = new Map(t.columns.filter(c => !c.type || c.type === 'data').map(c => [c.sourceColumn ?? c.name, c.dataType]));
    const file = join(modelDir(model), 'data', `${p.source.entityName}.csv`);
    const { columns, rows } = parseCsv(readFileSync(file, 'utf8'), c => types.get(c));
    const ty = columns.map(c => types.get(c));
    t.partitions = [{
      name: p.name,
      mode: 'import',
      source: {
        type: 'm',
        expression: [
          'let',
          `  Source = #table(type table [${columns.map((c, i) => `#"${c.replace(/"/g, '""')}" = ${M_TYPE[ty[i]]}`).join(', ')}], {`,
          ...rows.map((r, i) => `    {${r.map((v, j) => mValue(v, ty[j])).join(',')}}${i < rows.length - 1 ? ',' : ''}`),
          '  })',
          'in',
          '  Source',
        ],
      },
    }];
  }
  return bim;
}

const queries = loadQueries();
const models = [...new Set(queries.map(q => q.model))];
const names = Object.fromEntries(models.map(m => [m, `dax-conformance-${m}`]));
for (const model of models) {
  const bim = powerbiBim(model);
  const name = names[model];
  bim.name = name;
  const item = join(out, `${name}.SemanticModel`);
  mkdirSync(item, { recursive: true });
  writeFileSync(join(item, 'model.bim'), JSON.stringify(bim, null, 1));
  writeFileSync(join(item, 'definition.pbism'), JSON.stringify({ version: '1.0' }));
  // A logical id fixed by the name, so that a run updates the item an earlier one made.
  const h = createHash('sha1').update(name).digest('hex');
  writeFileSync(join(item, '.platform'), JSON.stringify({
    $schema: 'https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json',
    metadata: { type: 'SemanticModel', displayName: name },
    config: { version: '2.0', logicalId: `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}` },
  }, null, 2));
  console.log(`${item}: ${bim.model.tables.length} tables`);
}
writeFileSync(join(out, 'queries.json'), JSON.stringify({
  models: names,
  queries: queries.map(({ model, family, id, dax, roles, hash }) => ({ model, family, id, dax, roles, hash })),
}, null, 1));
console.log(`${queries.length} queries`);
