// Writes queries/aac/check/ and queries/aac/measures/.
//
// check: what analytics-as-code's scripts/check_model.py asks the deployed model, in its
// words: a row count per table; every measure per day over the newest week fct_summary holds
// (the measures of the tables by month per month, over the newest three); the whole history
// by year and fuel, from the daily table and, forced by a filter on fct_summary[date], from
// the 5-minute one.
//
// measures: every measure of the model once more, grouped by the dimension it is read by (a
// region, a fuel, a unit, a link, a time of day), over a range the sample holds.
//
//   node tools/aac/queries.mjs
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';

const bim = JSON.parse(readFileSync(new URL('../../models/aac/model.bim', import.meta.url), 'utf8')).model;
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const write = (family, files) => {
  const dir = new URL(`../../queries/aac/${family}/`, import.meta.url);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [id, note, dax] of files) writeFileSync(new URL(`${id}.dax`, dir), `// note: ${note}\n${dax}\n`);
  console.log(`queries/aac/${family}: ${files.length} queries`);
};

// --- check: check_model.py's queries, as it writes them ---
const MONTHLY = new Set(['dim_month', ...bim.relationships.filter(r => r.toTable === 'dim_month').map(r => r.fromTable)]);
const MEASURES = bim.tables.flatMap(t => (t.measures ?? []).map(m => [m.name, MONTHLY.has(t.name), t.name]));
const check = [
  ...bim.tables.map(t => [`check-rows-${slug(t.name)}`, `check_model.py: the row count of ${t.name}`,
    `EVALUATE ROW("table", "${t.name}", "rows", COUNTROWS('${t.name}'))`]),
  ...MEASURES.map(([m, monthly]) => [`check-measure-${slug(m)}`,
    `check_model.py: [${m}] ${monthly ? 'per month, over the newest three' : 'per day, over the newest week fct_summary holds'}`,
    monthly ? `EVALUATE
            VAR newest = MAX(dim_month[month])
            RETURN CALCULATETABLE(
                SUMMARIZECOLUMNS(dim_month[month], "${m}", [${m}]),
                dim_month[month] > EDATE(newest, -3))
            ORDER BY dim_month[month]` : `EVALUATE
            VAR newest = MAX(fct_summary[date])
            RETURN CALCULATETABLE(
                SUMMARIZECOLUMNS(dim_calendar[date], "${m}", [${m}]),
                dim_calendar[date] > newest - 7, dim_calendar[date] <= newest)
            ORDER BY dim_calendar[date]`]),
  ...[['daily', 'the daily table', ''], ['5-minute', 'the 5-minute table, forced by a filter on fct_summary[date]', 'TREATAS(VALUES(dim_calendar[date]), fct_summary[date]), ']]
    .map(([label, what, forced]) => [`check-history-${slug(label)}`, `check_model.py: [Generation MWh] by year and fuel over the whole history, from ${what}`,
      `EVALUATE SUMMARIZECOLUMNS(dim_calendar[year], dim_duid[FuelSourceDescriptor], ${forced}"MWh", [Generation MWh])`]),
];
write('check', check);

// --- measures: each by the dimension it is read by ---
const d = s => `dt"${s}"`;
const range = (from, to) => `dim_calendar[date] >= ${d(from)}, dim_calendar[date] <= ${d(to)}`;
const AUGUST = range('2026-08-01', '2026-08-13');
const WEEK = range('2026-08-07', '2026-08-13');      // whole days and the two the daily tables lack
const WHOLE = range('2026-08-04', '2026-08-07');     // whole days, and the four before them too
const DAY = (date) => `dim_calendar[date] = ${d(date)}`;
// [measure, group-by columns, filters, why]
const BY = {
  'Registered units': [['dim_duid[FuelSourceDescriptor]'], [], 'per fuel, the units that ran or not'],
  'Registered MW': [['dim_region[Region]'], [], 'per region of dim_region, which filters dim_duid'],
  'Storage MWh': [['dim_duid[Region]'], [], 'per region of the unit'],
  'Reads 5 minutes': [['dim_time[hour]'], ['dim_time[hour] IN {4, 12, 19}'], 'by hour of day, which asks for the 5-minute table'],
  'Newest whole day': [['dim_region[Region]'], [], 'per region: the same day whatever the filter'],
  'Generation MWh': [['dim_duid[FuelSourceDescriptor]'], [], 'per fuel over the whole sample: the daily table and the days after it'],
  'Charging MWh': [['dim_calendar[date]'], [WEEK], 'per day, across the newest whole day'],
  'Revenue': [['dim_duid[Region]'], [AUGUST], 'per region of the unit'],
  'Capture price': [['dim_duid[FuelSourceDescriptor]'], [AUGUST], 'per fuel'],
  'Units': [['dim_region[Region]'], [WEEK], 'per region, rooftop solar left out'],
  'Latest update': [['dim_region[Region]'], [], 'per region: the newest cutoff whatever the filter'],
  'Renewable share': [['dim_region[Region]'], [AUGUST], 'per region'],
  'Generation share': [['dim_duid[FuelSourceDescriptor]'], [WEEK], 'per fuel, of all the units shown'],
  'Renewable share change': [['dim_region[Region]'], [WHOLE], 'per region, against the four days before'],
  'Capacity MW': [['dim_duid[FuelSourceDescriptor]'], [WEEK], 'per fuel, the units with output'],
  'Capacity factor': [['dim_duid[FuelSourceDescriptor]'], [WEEK], 'per fuel'],
  'Generation MW': [['dim_time[time]'], [DAY('2026-08-12')], 'per 5-minute time of one day'],
  'Charging MW': [['dim_time[time]'], [DAY('2026-08-12')], 'per 5-minute time of one day'],
  'Average MW': [['dim_duid[DUID]'], [WEEK], 'per unit'],
  'Days with output': [['dim_duid[DUID]'], [AUGUST], 'per unit'],
  'Price seen': [['dim_duid[Region]'], [AUGUST], 'per region of the unit'],
  'Charging price': [['dim_duid[DUID]'], [AUGUST], 'per unit: the battery'],
  'Battery spread': [['dim_duid[DUID]'], [AUGUST], 'per unit: the battery'],
  'Average generation MW': [['dim_region[Region]'], [WHOLE], 'per region'],
  'Average generation MW change': [['dim_region[Region]'], [WHOLE], 'per region, against the four days before'],
  'Generation MW on an average day': [['dim_time[time]'], [AUGUST], 'per time of day'],
  'Charging MW on an average day': [['dim_time[time]'], [AUGUST], 'per time of day'],
  'Emissions t': [['dim_duid[FuelSourceDescriptor]'], [AUGUST], 'per fuel'],
  'Emissions intensity': [['dim_calendar[date]'], [WEEK], 'per day, across the newest whole day'],
  'Emissions intensity change': [['dim_region[Region]'], [WHOLE], 'per region, against the four days before'],
  'Reads 5 minutes regional': [['dim_region[Region]'], [], 'per region of dim_region, which does not ask for the 5-minute table'],
  'Newest whole day regional': [['dim_region[Region]'], [], 'per region: the same day whatever the filter'],
  'Average price': [['dim_region[Region]'], [AUGUST], 'per region'],
  'Average price change': [['dim_region[Region]'], [WHOLE], 'per region, against the four days before'],
  'Demand MWh': [['dim_calendar[date]'], [WEEK], 'per day, across the newest whole day of the regions'],
  'Net interchange MW': [['dim_region[Region]'], [AUGUST], 'per region'],
  'Demand MW': [['dim_region[Region]', 'dim_time[time]'], [DAY('2026-08-13')], 'per region and time of the newest day, one region without demand yet'],
  'Demand with rooftop MW': [['dim_time[time]'], [DAY('2026-08-12')], 'per time of one day'],
  'Demand with rooftop MWh': [['dim_region[Region]'], [WEEK], 'per region'],
  'Hours': [['dim_region[Region]'], [WEEK], 'per region, whole days and the 5-minute rows after them'],
  'Negative price share': [['dim_region[Region]'], [AUGUST], 'per region'],
  'Lowest price': [['dim_region[Region]'], [AUGUST], 'per region'],
  'Average demand MW': [['dim_calendar[date]'], [WEEK], 'per day'],
  'Regional wind curtailed MWh': [['dim_region[Region]'], [], 'per region'],
  'Regional wind available MWh': [['dim_calendar[date]'], [range('2026-07-30', '2026-08-03')], 'per day, blank before August'],
  'Regional solar curtailed MWh': [['dim_region[Region]'], [], 'per region'],
  'Regional solar available MWh': [['dim_time[time]'], [AUGUST], 'per time of day'],
  'Flow MW': [['dim_interconnector[interconnector]'], [], "per link, the blank row holding the link dim_interconnector lacks"],
  'Flow utilisation': [['fct_interconnector[interconnector]', 'fct_interconnector[time]'], ["fct_interconnector[date] = " + d('2026-08-05')], 'per link and interval of a day Basslink is out'],
  'No flow': [['fct_interconnector[interconnector]', 'fct_interconnector[time]'], ["fct_interconnector[date] = " + d('2026-08-05')], 'per link and interval of a day Basslink is out'],
  'Curtailed MWh': [['dim_duid[DUID]'], [], 'per unit, the blank row holding the farm dim_duid lacks'],
  'Available MWh': [['dim_duid[FuelSourceDescriptor]'], [], 'per fuel of the unit'],
  'Curtailment rate': [['dim_calendar[date]'], [WEEK], 'per day'],
  'Wind and solar curtailed MWh': [['dim_region[Region]'], [], 'per region'],
  'Wind and solar available MWh': [['fct_curtailment_region[fuel]', 'fct_curtailment_region[source]'], [], 'per fuel and source'],
  'Wind and solar curtailment rate': [['dim_calendar[date]'], [WEEK], 'per day, the farms\' figures then AEMO\'s'],
  'Average MWh a day': [['dim_duid[DUID]'], [], 'per unit'],
  'Negative price days share': [['dim_region[Region]'], [], 'per region'],
  'Lowest daily price': [['dim_region[Region]'], [], 'per region'],
  'Month days': [['dim_month[month]'], [], 'per month'],
  'Output MWh hourly': [['dim_month[month]', 'fct_summary_hourly[hour]'], [], 'per month and hour of day'],
  'Average MW at hour': [['fct_summary_hourly[hour]'], [], 'per hour of day, over both months'],
  'Price at hour': [['dim_region[Region]', 'fct_region_hourly[hour]'], [], 'per region and hour of day'],
};
const missing = MEASURES.filter(([m]) => !BY[m]).map(([m]) => m);
const extra = Object.keys(BY).filter(m => !MEASURES.some(([n]) => n === m));
if (missing.length || extra.length) throw new Error(`measures without a query: ${missing.join(', ')}; queries without a measure: ${extra.join(', ')}`);
write('measures', MEASURES.map(([m, , table]) => {
  const [cols, filters, why] = BY[m];
  const t = `SUMMARIZECOLUMNS(${[...cols, `"${m}", [${m}]`].join(', ')})`;
  return [`measures-${slug(m)}`, `${table}[${m}] ${why}`, `EVALUATE ${filters.length ? `CALCULATETABLE(${t}, ${filters.join(', ')})` : t}`];
}));
