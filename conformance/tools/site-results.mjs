// The engines' results for the site's "Ossie compiler" tab: each engine's latest report from CI
// (the runner's --report JSON, downloaded by pages.yml into a folder of each artifact), as one
// results.json: for each engine its counts and the
// queries it does not answer as Power BI does, each with its known list's reason.
//
//   node conformance/tools/site-results.mjs <artifacts dir> <out.json>
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, out] = process.argv.slice(2);
const read = p => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const known = files => new Map(files.flatMap(f => read(join('conformance/engines', f)) ?? []).map(k => [k.id, k.reason]));

// The engines, each a report of the runner and the known lists it was held to: one for each
// engine, with the query plan it is given (DuckDB unnests the correlated plan itself; the others
// are given it unnested, src/passes/unnest.js).
const ENGINES = [
  { engine: 'DuckDB', path: 'correlated', artifact: 'plan-report', report: 'plan-correlated.json', known: ['dax-sql/known.json'] },
  { engine: 'Fabric DWH', path: 'unnested by the compiler', artifact: 'tsql-report', report: 'tsql-unnest.json', known: ['dax-sql-tsql/known.json', 'dax-sql-tsql/known-unnest.json'] },
  { engine: 'Polars', path: 'unnested by the compiler', artifact: 'polars-report', report: 'polars.json', known: ['dax-sql-polars/known.json', 'dax-sql/known.json'] },
  { engine: 'DataFusion', path: 'unnested by the compiler', artifact: 'datafusion-report', report: 'datafusion.json', known: ['dax-sql-datafusion/known.json', 'dax-sql/known.json'] },
];

const rows = [];
for (const e of ENGINES) {
  const r = read(join(dir, e.artifact, e.report));
  if (!r) continue;
  const reasons = known(e.known);
  rows.push({
    engine: e.engine, path: e.path, total: r.total, queries: r.queries.length,
    // What it does not answer as Power BI does, a known one with its reason.
    misses: r.queries.filter(q => q.outcome !== 'match' && q.outcome !== 'pending' && q.outcome !== 'invalid')
      .map(q => ({ id: q.id, outcome: q.outcome, known: q.known, reason: q.known ? reasons.get(q.id) ?? null : String(q.detail ?? '').split('\n')[0].slice(0, 300) })),
  });
}
// Power BI first: the answers the others are held to (its own, every one): the queries it answered
// when the first engine's report was made (not one still pending, nor one it refused), so that
// every row is of the same queries.
if (rows.length) {
  const t = rows[0].total, n = t.match + t.fail + t.error + t.unsupported;
  rows.unshift({ engine: 'Power BI', path: 'n/a', reference: true, total: { match: n, fail: 0, error: 0, unsupported: 0, known: 0 }, queries: n, misses: [] });
}
writeFileSync(out, JSON.stringify({ built: new Date().toISOString(), engines: rows }));
console.log(`${rows.length} engines: ${rows.map(r => `${r.engine} (${r.path}) ${r.total.match}/${r.queries}`).join('; ')}`);
