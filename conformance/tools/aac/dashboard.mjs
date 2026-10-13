// Writes queries/aac/dashboard/: the DAX analytics-as-code's dashboard sends, written by the
// dashboard's own code, not by hand. Its page asks in query objects
// (dashboard/github/dax/frontend/queries.js) that semantic/query.js's toDax writes as DAX; its
// parity check (scripts/parity/page_states.mjs) calls every member the way index.html does
// over 15 page states (3 days, 30 days and 1 year, by five filters), and the filter lists
// once. Here the same, with the dates of this model's sample: the newest day 2026-08-13, the
// states ending two days before it, the daily tables holding 2026-07-28 to 2026-08-11 (units)
// and 2026-08-12 (regions).
//
// One query per shape (the DAX without its literals): 30 days has the shape of 3 days (the
// 5-minute tables) and is left out for it, so a result stays small; 1 year reads the daily
// tables. Where a query has an ORDER BY, its keys (the columns it groups by and its totals'
// flags) are added after the page's order, so that the order is total; nothing else is
// changed.
//
//   node tools/aac/dashboard.mjs <analytics-as-code checkout>
//
// The checkout's compiler (its dax-sql submodule) is not loaded: toDax needs none, and a stub
// stands in for it.
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = process.argv[2];
if (!repo) { console.error('usage: node tools/aac/dashboard.mjs <analytics-as-code checkout>'); process.exit(2); }

// The page staged as stage_pages.mjs stages it, with a stub for the compiler.
const page = mkdtempSync(path.join(tmpdir(), 'aac-page-'));
mkdirSync(path.join(page, 'semantic/dax-sql'), { recursive: true });
mkdirSync(path.join(page, 'frontend'));
copyFileSync(path.join(repo, 'dashboard/github/dax/semantic/query.js'), path.join(page, 'semantic/query.js'));
copyFileSync(path.join(repo, 'dashboard/github/dax/frontend/queries.js'), path.join(page, 'frontend/queries.js'));
writeFileSync(path.join(page, 'semantic/dax-sql/index.js'), 'export const createCompiler = () => ({ compile() { throw new Error("no compiler here"); } });\n');
writeFileSync(path.join(page, 'page_states.mjs'), readFileSync(path.join(repo, 'scripts/parity/page_states.mjs'), 'utf8')
  .replace(/^import \{ DuckDBInstance \} from '@duckdb\/node-api';$/m, ''));
// The page's semantic/query.js fetches its model next to itself: model.bim in a checkout from
// before 2026-10-14, the Ossie model (staged as ossie.json, read with formats/ossie.js) after.
mkdirSync(path.join(page, 'semantic/formats'));
for (const f of ['tmsl.js', 'ossie.js']) copyFileSync(new URL(`../../../formats/${f}`, import.meta.url), path.join(page, 'semantic/formats', f));
const bimPath = path.join(repo, 'semantic_model/model.bim');
const model = existsSync(bimPath) ? JSON.parse(readFileSync(bimPath, 'utf8'))
  : createRequire(import.meta.url)('yaml').parse(readFileSync(path.join(repo, 'semantic_model/ossie.yaml'), 'utf8'));
globalThis.fetch = async () => ({ ok: true, json: async () => model });
const { toDax } = await import(pathToFileURL(path.join(page, 'semantic/query.js')));
const { createQueries } = await import(pathToFileURL(path.join(page, 'frontend/queries.js')));
const { pageOf, states, lists, asked, shiftDate } = await import(pathToFileURL(path.join(page, 'page_states.mjs')));
rmSync(page, { recursive: true, force: true });

const NEWEST = '2026-08-13';
const HELD = { fct_summary_daily: { first: '2026-07-28', last: '2026-08-11' }, fct_region_daily: { first: '2026-07-28', last: '2026-08-12' } };
const to = shiftDate(NEWEST, -2);
const { queries, set } = pageOf(createQueries, NEWEST);

// What each member draws, for the note.
const WHAT = {
  readWholeDays: 'the first and last day a daily table holds',
  regions: 'the region filter list: the regions that have a price',
  regionNames: "the regions' names",
  fuels: 'the fuel filter list',
  allDuids: 'the unit picker: every unit with its region and fuel',
  oldestDate: 'the first day the date input offers',
  flowUnits: "every unit's fuel, storage flag and position (Flows)",
  interconnectors: 'the links between regions (Flows)',
  stationUnits: "a plant's units, which a click in the drill toggles",
  newestDate: 'the newest day of the units',
  regionNewestDate: 'the newest day of the regional table',
  curtailmentLastDay: 'the newest day of the farms\' curtailment',
  cutoff: 'the newest interval of the units, on the newest day',
  regionNewestTime: 'the newest time of the regional table on a day',
  generation: 'the generation chart: output and charging per series and interval, with the per-interval total',
  generationNotOf: 'the generation chart\'s "Other units": the series not drawn one by one',
  generationOf: 'the hero\'s "Other" fuels, added up per interval',
  averages: 'the generation KPIs: each series as an average MW with its share, largest first',
  generationAverage: 'the generation KPI over the range',
  demand: 'the demand line over the generation chart, rooftop solar included',
  demandPeak: 'the demand peak: the largest row of the demand line (TOPN 1)',
  price: 'the price chart: per region and interval, with all regions\' total',
  averagePrice: 'the price KPI over the range',
  generatorCount: 'the units KPI',
  emissions: 'emissions tonnes and intensity per interval, with the range\'s total',
  renewableShareByPeriod: 'the renewable share per interval (the fuel filter ignored)',
  renewableShareOfRange: 'the renewable share KPI over the range',
  nowByFuel: '"Right now": per fuel at one interval, output, charging and share, with the total',
  nowShare: '"Right now": the renewable share at one interval',
  nowOf: '"Right now": the output of some fuels together (the hero\'s "Other")',
  nowByRegion: '"Right now": each region\'s price, demand and net interchange at one interval',
  mapScatter: 'the map: each unit with a position and its average MW',
  profile: 'the average day by fuel: by time of day, or by hour from the monthly table',
  profileMonths: 'the whole months an average day reads beyond 30 days',
  curtailment: 'the curtailment chart: per day (per month beyond 120 days) and fuel',
  curtailmentTotal: 'the curtailment KPI over the range',
  curtailedFarms: 'the 15 farms that lost the most to curtailment',
  heatmap: 'the price heatmap: per date (month) and hour',
  capture: 'capture price by fuel, the fuels with half a percent or more of the output',
  negativePrices: 'the negative-price share and the lowest price per region',
  netExports: 'net exports per region and interval',
  capacityFactor: 'capacity factor per unit and per fuel (the total rows)',
  owners: 'energy by owner and plant, with its share',
  ownerShares: "each owner's energy and share",
  historyShare: 'History: the renewable share per day',
  historySolar: 'History: the energy of solar, rooftop included, per day',
  historyWind: 'History: the energy of wind per day',
  historyPrice: 'History: the average price and demand per day',
  changeGeneration: 'the generation KPI\'s change against the days before',
  changePrice: 'the price KPI\'s change against the days before',
  changeRenewables: 'the renewable share KPI\'s change against the days before',
  changeEmissions: 'the emissions intensity KPI\'s change against the days before',
  batteryDay: 'batteries: discharge, charge and price seen on an average day',
  batterySpread: 'batteries: sold and bought prices and their spread',
  batteryFleet: 'batteries: the fleet\'s units, MW and MWh',
  flowGens: 'Flows: each unit\'s MW per interval of a day, the units at 1 MW or more either way',
  flowNow: 'Flows: the generators\' output and renewable share per interval of a day',
  flows: 'Flows: the links\' flows and limits per interval, with utilisation and outage flag',
  flowPrices: 'Flows: each region\'s price and net interchange per interval',
};
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const STATE = { '3 days': '3d', '30 days': '30d', '1 year': '1y', all: 'all', 'region SA1': 'sa1', 'fuel Wind': 'wind',
  'units HPR1 BALDHWF1': 'units', 'fuel Solar, units HPR1 BALDHWF1': 'solar-units' };
const stateId = s => s === 'lists' ? '' : s.split(', ').length === 3
  ? `${STATE[s.split(', ')[0]]}-solar-units` : s.split(', ').map(x => STATE[x]).join('-');

// The order made total: the page's, then the keys it lacks.
const total = q => {
  if (!q.orderBy) return q;
  const have = new Set(q.orderBy.map(o => (Array.isArray(o) ? o[0] : o)));
  const keys = [...Object.entries(q.select).filter(([, f]) => typeof f === 'string' && f.includes('.')).map(([n]) => n), ...Object.keys(q.totals ?? {})];
  return { ...q, orderBy: [...q.orderBy, ...keys.filter(k => !have.has(k))] };
};

// The last filter state (fuel Solar and two units, which no unit passes together) is the
// check that a fuel or unit pick reaches the regional tables as the regions of the units
// that pass both, none: it is kept for the members that read a regional table (directly, or
// through [Hours]); for the others it says only that no unit passes.
const REGIONAL = new Set(['price', 'averagePrice', 'heatmap', 'negativePrices', 'netExports', 'averages', 'generationAverage',
  'capacityFactor', 'changeGeneration', 'changePrice', 'changeRenewables', 'changeEmissions']);

const out = [], seenDax = new Set(), seenShape = new Set();
const shape = s => s.replace(/dt"[^"]*"/g, 'D').replace(/"(?:[^"]|"")*"/g, 'S').replace(/\b\d+\b/g, 'N');
const add = (state, name, q, member = name) => {
  if (!q || (state.includes('fuel Solar') && !REGIONAL.has(member))) return;
  const dax = toDax(total(q));
  if (seenDax.has(dax) || seenShape.has(shape(dax))) return;
  seenDax.add(dax); seenShape.add(shape(dax));
  const id = `dashboard-${[slug(name), stateId(state)].filter(Boolean).join('-')}`;
  const [range, ...filters] = state.split(', ');
  const where = state === 'lists' ? '' : ` (page state: ${range} to ${to}, ${filters.join(', ')})`;
  out.push({ id, text: `// note: the dashboard's ${member} query, ${WHAT[member]}${where}\n${dax}\n` });
};

await queries.readWholeDays(async q => {
  const t = q.select.first.min.split('.')[0];
  add('lists', `readWholeDays ${t}`, q, 'readWholeDays');
  return [HELD[t]];
});
for (const [n, q] of Object.entries(lists(queries))) add('lists', n, q);
add('lists', 'newestDate', queries.newestDate);
add('lists', 'regionNewestDate', queries.regionNewestDate);
add('lists', 'curtailmentLastDay', queries.curtailmentLastDay);
add('lists', 'cutoff', queries.cutoff());
add('lists', 'regionNewestTime', queries.regionNewestTime(NEWEST));
// 3 days before 30 days: a shape is kept at the state where it is smallest.
const all = states(to);
for (const [name, state] of [...all.filter(([n]) => !n.startsWith('30 days')), ...all.filter(([n]) => n.startsWith('30 days'))]) {
  set(state);
  for (const [n, q] of Object.entries(asked(queries, state))) add(name, n, q, n.split(' ')[0]);
}

const dir = new URL('../../queries/aac/dashboard/', import.meta.url);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const ids = new Set();
for (const { id, text } of out) {
  if (ids.has(id)) throw new Error(`two queries ${id}`);
  ids.add(id);
  writeFileSync(new URL(`${id}.dax`, dir), text);
}
console.log(`queries/aac/dashboard: ${out.length} queries`);
