// Writes queries/tpcds/: paper/, bench/, measures/, relationships/ and check/.
//
// paper: the paper's fifteen visual queries, as its report sent them (paper_queries.json, the
// Performance Analyzer capture of github.com/lipinght/DB-DQ-Whitepaper). Two edits only:
//   - the report kept its measures on a 'Measures 1' table this model does not have, so
//     'Measures 1'[X] becomes the measure's own table, 'store_sales'[X] or 'catalog_sales'[X];
//   - the rank visual (q3) sends two EVALUATEs, and a query here is one: it becomes two queries,
//     each with the whole DEFINE, one for each result.
//
// bench: what direct-lake-parquet-layout's benchmark/xmla_compare.py asks the model besides the
// paper's queries (TPCDS_QUERIES), with the sample's year (2025) for its 2022 and a store the
// sample holds for its {key}.
//
// measures: every measure of the model, grouped by the dimension it is read by.
// relationships: the inactive relationships, through USERELATIONSHIP, and a CROSSFILTER.
// check: a row count per table.
//
//   node tools/tpcds/queries.mjs
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';

const bim = JSON.parse(readFileSync(new URL('../../models/tpcds/model.bim', import.meta.url), 'utf8')).model;
const paper = JSON.parse(readFileSync(new URL('paper_queries.json', import.meta.url), 'utf8'));
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const write = (family, files) => {
  const dir = new URL(`../../queries/tpcds/${family}/`, import.meta.url);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [id, note, dax] of files) writeFileSync(new URL(`${id}.dax`, dir), `// note: ${note}\n${dax}\n`);
  console.log(`queries/tpcds/${family}: ${files.length} queries`);
};

const HOME = new Map(bim.tables.flatMap(t => (t.measures ?? []).map(m => [m.name, t.name])));
const MEASURES = bim.tables.flatMap(t => (t.measures ?? []).map(m => [m.name, t.name]));

// --- paper: the report's queries, as captured ---
const ROUND = { AR: 'round 1 (state AR)', CO: 'round 2 (state CO, a store manager)', CA: 'round 3 (state CA, a manager, a carrier, a page type)' };
const papers = [];
for (const q of paper.queries) {
  const dax = q.dax.replace(/\r\n/g, '\n').trimEnd().replace(/'Measures 1'\[([^\]]+)\]/g, (_, m) => {
    if (!HOME.has(m)) throw new Error(`${q.name}: no measure [${m}]`);
    return `'${HOME.get(m)}'[${m}]`;
  });
  const [define, ...evaluates] = dax.split(/\n(?=EVALUATE\b)/);
  const id = `paper-${slug(q.name)}`, note = `the paper's "${q.visual}" visual, ${ROUND[q.slicer_state]}, as Power BI wrote it`;
  if (evaluates.length === 1) papers.push([id, note, dax]);
  else if (evaluates.length === 2) {
    papers.push([`${id}-bounds`, `${note}: its first result, the visual calculation's lowest and highest rank`, `${define}\n${evaluates[0].trimEnd()}`]);
    papers.push([id, `${note}: its second result, the bars`, `${define}\n${evaluates[1]}`]);
  } else throw new Error(`${q.name}: ${evaluates.length} EVALUATEs`);
}
write('paper', papers);

// --- bench: xmla_compare.py's TPCDS_QUERIES, the paper's left out ---
const YEAR = 2025, STORE = 1;
const sel = filters => `EVALUATE ROW("r", CALCULATE(SUMX(store_sales, store_sales[ss_quantity] * store_sales[ss_ext_sales_price]), ${filters}))`;
write('bench', [
  ['bench-probe-ext-sales-price', 'xmla_compare.py probe: SUM of a decimal column', 'EVALUATE ROW("x", SUM(store_sales[ss_ext_sales_price]))'],
  ['bench-probe-quantity', 'xmla_compare.py probe: SUM of an integer column', 'EVALUATE ROW("x", SUM(store_sales[ss_quantity]))'],
  ['bench-probe-item', 'xmla_compare.py probe: DISTINCTCOUNT of a key', 'EVALUATE ROW("x", DISTINCTCOUNT(store_sales[ss_item_sk]))'],
  ['bench-probe-customer', 'xmla_compare.py probe: DISTINCTCOUNT of a key with no dimension', 'EVALUATE ROW("x", DISTINCTCOUNT(store_sales[ss_customer_sk]))'],
  ['bench-probe-store', 'xmla_compare.py probe: DISTINCTCOUNT of the store key', 'EVALUATE ROW("x", DISTINCTCOUNT(store_sales[ss_store_sk]))'],
  ['bench-probe-sold-date', 'xmla_compare.py probe: COUNTROWS of VALUES of the date key', 'EVALUATE ROW("x", COUNTROWS(VALUES(store_sales[ss_sold_date_sk])))'],
  ['bench-probe-rowcount', 'xmla_compare.py probe: COUNTROWS of the fact', 'EVALUATE ROW("x", COUNTROWS(store_sales))'],
  ['bench-wide-all-measures', 'xmla_compare.py: five measures of both facts by year', 'EVALUATE SUMMARIZECOLUMNS(date_dim[d_year], "a", [Store Revenue], "b", [Store Net Profit], "c", [Store Distinct Customers], "d", [Catalog Revenue], "e", [Catalog Sales Quantity])'],
  ['bench-narrow-one-measure', 'xmla_compare.py: one measure by year', 'EVALUATE SUMMARIZECOLUMNS(date_dim[d_year], "a", [Store Revenue])'],
  ['bench-catalog-by-ship-mode-x-year', 'xmla_compare.py: catalog measures by ship-mode type and year', 'EVALUATE SUMMARIZECOLUMNS(ship_mode[sm_type], date_dim[d_year], "Revenue", [Catalog Revenue], "Qty", [Catalog Sales Quantity])'],
  ['bench-catalog-by-page-type', 'xmla_compare.py: catalog measures by page type', 'EVALUATE SUMMARIZECOLUMNS(catalog_page[cp_type], "Revenue", [Catalog Revenue], "Profit", [Catalog Net Profit])'],
  ['bench-raw-archive-log', 'xmla_compare.py: the landing log\'s measures by source type', 'EVALUATE SUMMARIZECOLUMNS(stg_tpcds_archive_log[source_type], "Files", [Archive Files], "Rows", [Archive Source Rows])'],
  ['bench-sel-1yr', 'xmla_compare.py selectivity ladder: SUMX of a product, one year', sel(`date_dim[d_year] = ${YEAR}`)],
  ['bench-sel-1mo', 'xmla_compare.py selectivity ladder: SUMX of a product, one month', sel(`date_dim[d_year] = ${YEAR}, date_dim[d_moy] = 6`)],
  ['bench-sel-1store', 'xmla_compare.py selectivity ladder: SUMX of a product, one store', sel(`store_sales[ss_store_sk] = ${STORE}`)],
  ['bench-sel-1store-1mo', 'xmla_compare.py selectivity ladder: SUMX of a product, one store and month', sel(`store_sales[ss_store_sk] = ${STORE}, date_dim[d_year] = ${YEAR}, date_dim[d_moy] = 6`)],
]);

// --- measures: each by the dimension it is read by ---
const years = ys => `date_dim[d_year] IN {${ys.join(', ')}}`;
// [measure, group-by columns, filters, why]
const BY = {
  'Store Revenue': [["'item'[i_category]"], [], 'per item category'],
  'Store Net Profit': [['store[s_store_name]'], [], 'per store, some sales at a loss'],
  'Store Distinct Customers': [['customer_address[ca_state]'], [], 'per state of the address'],
  'Store Profit % by Item Category': [["'item'[i_category]", 'date_dim[d_year]'], [years([2025, 2026])], 'per category and year: each category\'s share of the year\'s profit'],
  'Store Revenue Same Period LY': [['date_dim[d_year]', 'date_dim[d_moy]'], [years([2025, 2026])], 'per month, a year back'],
  'Store Revenue YoY': [['date_dim[d_quarter_name]'], [], 'per quarter, blank in the first year'],
  'Store Revenue YTD': [['date_dim[d_year]', 'date_dim[d_moy]'], [years([2025])], 'per month of a year, running from January'],
  'Catalog Revenue': [['ship_mode[sm_type]'], [], 'per ship-mode type'],
  'Catalog Sales Quantity': [['catalog_page[cp_type]'], [], 'per catalog-page type'],
  'Catalog Sales Same Period LY': [['date_dim[d_quarter_name]'], [], 'per quarter, a year back, blank in the first year'],
  'Catalog Sales YoY': [['date_dim[d_year]', 'date_dim[d_moy]'], [years([2026])], 'per month of the newest year'],
  'Catalog Net Profit': [['customer_demographics[cd_education_status]'], [], 'per education status of the bill-to demographic'],
  'Archive Files': [['stg_tpcds_archive_log[source_type]'], [], 'per source type'],
  'Archive Source Rows': [['stg_tpcds_archive_log[file_stem]'], [], 'per file'],
};
const missing = MEASURES.filter(([m]) => !BY[m]).map(([m]) => m);
const extra = Object.keys(BY).filter(m => !HOME.has(m));
if (missing.length || extra.length) throw new Error(`measures without a query: ${missing.join(', ')}; queries without a measure: ${extra.join(', ')}`);
write('measures', MEASURES.map(([m, table]) => {
  const [cols, filters, why] = BY[m];
  const t = `SUMMARIZECOLUMNS(${[...cols, `"${m}", [${m}]`].join(', ')})`;
  return [`measures-${slug(m)}`, `${table}[${m}] ${why}`, `EVALUATE ${filters.length ? `CALCULATETABLE(${t}, ${filters.join(', ')})` : t}`];
}));

// --- relationships: the inactive ones, and one made both ways ---
const SHIP_ADDR = 'USERELATIONSHIP(catalog_sales[cs_ship_addr_sk], customer_address[ca_address_sk])';
const SHIP_DEMO = 'USERELATIONSHIP(catalog_sales[cs_ship_cdemo_sk], customer_demographics[cd_demo_sk])';
write('relationships', [
  ['relationships-ship-address', 'catalog revenue per state, billed to (active) and shipped to (inactive, USERELATIONSHIP)',
    `EVALUATE SUMMARIZECOLUMNS(customer_address[ca_state], "billed", [Catalog Revenue], "shipped", CALCULATE([Catalog Revenue], ${SHIP_ADDR}))`],
  ['relationships-ship-demographics', 'catalog quantity per education status, of the bill-to (active) and the ship-to (inactive) demographic',
    `EVALUATE SUMMARIZECOLUMNS(customer_demographics[cd_education_status], "billed", [Catalog Sales Quantity], "shipped", CALCULATE([Catalog Sales Quantity], ${SHIP_DEMO}))`],
  ['relationships-ship-both', 'catalog revenue per education status shipped to CA: two inactive relationships at once',
    `EVALUATE CALCULATETABLE(SUMMARIZECOLUMNS(customer_demographics[cd_education_status], "shipped", [Catalog Revenue]), ${SHIP_ADDR}, ${SHIP_DEMO}, customer_address[ca_state] = "CA")`],
  ['relationships-promotion-item', 'promotions per item category: none follows the inactive promotion-to-item relationship until USERELATIONSHIP',
    `EVALUATE SUMMARIZECOLUMNS('item'[i_category], "all", COUNTROWS(promotion), "of the item", CALCULATE(COUNTROWS(promotion), USERELATIONSHIP(promotion[p_item_sk], 'item'[i_item_sk])))`],
  ['relationships-crossfilter-store', 'stores per item category: a store is filtered by the items it sold only once CROSSFILTER makes store_sales filter it',
    `EVALUATE SUMMARIZECOLUMNS('item'[i_category], "all", COUNTROWS(store), "sold there", CALCULATE(COUNTROWS(store), CROSSFILTER(store_sales[ss_store_sk], store[s_store_sk], BOTH)))`],
]);

// --- visual: visual calculations on the shapes a matrix sends, each the whole visual table ---
// L: two levels on the rows (a store's state, then the store). X: the stores on the rows and
// the years on the columns, under slicers that leave some cells empty, for DENSIFY to add.
const SHAPES = {
  l: {
    core: `SUMMARIZECOLUMNS(ROLLUPADDISSUBTOTAL('store'[s_state], "T1", 'store'[s_store_name], "T2"), "Rev", [Store Revenue])`,
    cols: [['state', `'store'[s_state]`], ['T1', '[T1]'], ['store', `'store'[s_store_name]`], ['T2', '[T2]'], ['Rev', '[Rev]']],
    shape: `AXIS rows
			GROUP [state] TOTAL [T1]
			GROUP [store] TOTAL [T2]
			ORDER BY [state] ASC, [store] ASC`,
    order: ['T1', 'state', 'T2', 'store'],
    what: 'two levels on the rows, state then store',
  },
  x: {
    core: `SUMMARIZECOLUMNS(ROLLUPADDISSUBTOTAL('store'[s_store_name], "TR"), ROLLUPADDISSUBTOTAL('date_dim'[d_year], "TC"), TREATAS({"AR"}, 'customer_address'[ca_state]), TREATAS({"2 yr Degree"}, 'customer_demographics'[cd_education_status]), "Rev", [Store Revenue])`,
    cols: [['store', `'store'[s_store_name]`], ['TR', '[TR]'], ['year', `'date_dim'[d_year]`], ['TC', '[TC]'], ['Rev', '[Rev]']],
    shape: `AXIS rows
			GROUP [store] TOTAL [TR]
			ORDER BY [store] ASC
		AXIS columns
			GROUP [year] TOTAL [TC]
			ORDER BY [year] ASC`,
    order: ['TR', 'store', 'TC', 'year'],
    what: 'stores on the rows, years on the columns',
  },
  t: {
    core: `SUMMARIZECOLUMNS(ROLLUPADDISSUBTOTAL('store'[s_state], "T1", 'store'[s_city], "T2", 'store'[s_store_name], "T3"), "Rev", [Store Revenue])`,
    cols: [['state', `'store'[s_state]`], ['T1', '[T1]'], ['city', `'store'[s_city]`], ['T2', '[T2]'], ['store', `'store'[s_store_name]`], ['T3', '[T3]'], ['Rev', '[Rev]']],
    shape: `AXIS rows
			GROUP [state] TOTAL [T1]
			GROUP [city] TOTAL [T2]
			GROUP [store] TOTAL [T3]
			ORDER BY [state] ASC, [city] ASC, [store] ASC`,
    order: ['T1', 'state', 'T2', 'city', 'T3', 'store'],
    what: 'three levels on the rows, state, city, store',
  },
  d: {
    core: `SUMMARIZECOLUMNS(ROLLUPADDISSUBTOTAL('store'[s_store_name], "TR"), ROLLUPADDISSUBTOTAL('promotion'[p_promo_name], "TC"), TREATAS({"AR"}, 'customer_address'[ca_state]), TREATAS({"2 yr Degree"}, 'customer_demographics'[cd_education_status]), TREATAS({2024}, 'date_dim'[d_year]), "Rev", [Store Revenue])`,
    cols: [['store', `'store'[s_store_name]`], ['TR', '[TR]'], ['promo', `'promotion'[p_promo_name]`], ['TC', '[TC]'], ['Rev', '[Rev]']],
    shape: `AXIS rows
			GROUP [store] TOTAL [TR]
			ORDER BY [store] ASC
		AXIS columns
			GROUP [promo] TOTAL [TC]
			ORDER BY [promo] ASC`,
    order: ['TR', 'store', 'TC', 'promo'],
    what: 'stores on the rows, promotions on the columns, many cells empty',
  },
};
const visual = (s, calc) => `DEFINE
	COLUMN 'V'[calc] = ${calc}
	TABLE 'V' =
		SELECTCOLUMNS(
			${s.core},
			${s.cols.map(([n, e]) => `"${n}", ${e}`).join(', ')}
		)
		WITH VISUAL SHAPE
		${s.shape}
		DENSIFY "IsDensifiedRow"
EVALUATE 'V'
ORDER BY ${s.order.map(c => `'V'[${c}]`).join(', ')}`;
// [shape, name, calculation, what it asks, expect]
const VISUALS = [
  ['l', 'rank', 'RANK(ORDERBY([Rev], DESC))', 'RANK with no axis or reset'],
  ['l', 'rank-highestparent', 'RANK(ORDERBY([Rev], DESC), HIGHESTPARENT)', 'RANK with an ORDERBY cannot take a reset', 'error'],
  ['l', 'rank-lowestparent', 'RANK(ORDERBY([Rev], DESC), LOWESTPARENT)', 'RANK with an ORDERBY cannot take a reset', 'error'],
  ['l', 'rank-none', 'RANK(ORDERBY([Rev], DESC), NONE)', 'RANK with an ORDERBY cannot take a reset', 'error'],
  ['l', 'next', 'NEXT([Rev])', 'NEXT with no axis'],
  ['l', 'last', 'LAST([Rev])', 'LAST with no axis'],
  ['t', 'runningsum', 'RUNNINGSUM([Rev])', 'RUNNINGSUM with no reset'],
  ['t', 'runningsum-none', 'RUNNINGSUM([Rev], NONE)', 'RUNNINGSUM, reset NONE'],
  ['t', 'runningsum-highestparent', 'RUNNINGSUM([Rev], HIGHESTPARENT)', 'RUNNINGSUM, reset at the highest parent'],
  ['t', 'runningsum-lowestparent', 'RUNNINGSUM([Rev], LOWESTPARENT)', 'RUNNINGSUM, reset at the lowest parent'],
  ['t', 'runningsum-reset-1', 'RUNNINGSUM([Rev], 1)', 'RUNNINGSUM, reset at level 1'],
  ['t', 'runningsum-reset-2', 'RUNNINGSUM([Rev], 2)', 'RUNNINGSUM, reset at level 2'],
  ['t', 'runningsum-reset-minus-1', 'RUNNINGSUM([Rev], -1)', 'RUNNINGSUM, reset one level up'],
  ['t', 'rownumber-highestparent', 'ROWNUMBER(HIGHESTPARENT)', 'ROWNUMBER, reset at the highest parent'],
  ['t', 'rownumber-lowestparent', 'ROWNUMBER(LOWESTPARENT)', 'ROWNUMBER, reset at the lowest parent'],
  ['t', 'collapse', 'COLLAPSE([Rev], ROWS)', 'COLLAPSE one level'],
  ['t', 'expand', 'EXPAND([Rev], ROWS)', 'EXPAND of a column, which is not one value at a parent', 'error'],
  ['t', 'isatlevel-city', 'ISATLEVEL([city])', 'ISATLEVEL of the middle level'],
  ['d', 'densify', '[Rev] * 1', 'DENSIFY: the cells SUMMARIZECOLUMNS left out'],
  ['d', 'runningsum', 'RUNNINGSUM([Rev])', 'RUNNINGSUM over densified cells'],
  ['d', 'previous-columns', 'PREVIOUS([Rev], COLUMNS)', 'PREVIOUS along the columns, over densified cells'],
  ['d', 'rank', 'RANK(ORDERBY([Rev], DESC))', 'RANK over densified cells'],
  ['l', 'rownumber', 'ROWNUMBER()', 'ROWNUMBER with no argument: the axis order'],
  ['l', 'runningsum', 'RUNNINGSUM([Rev])', 'RUNNINGSUM with no axis or reset'],
  ['l', 'runningsum-highestparent', 'RUNNINGSUM([Rev], HIGHESTPARENT)', 'RUNNINGSUM, reset at the highest parent'],
  ['l', 'movingaverage', 'MOVINGAVERAGE([Rev], 2)', 'MOVINGAVERAGE over two rows'],
  ['l', 'previous', 'PREVIOUS([Rev])', 'PREVIOUS with no axis'],
  ['l', 'first', 'FIRST([Rev])', 'FIRST with no axis'],
  ['l', 'collapse', 'COLLAPSE([Rev], ROWS)', 'COLLAPSE one level of the rows'],
  ['l', 'collapseall-share', 'DIVIDE([Rev], COLLAPSEALL([Rev], ROWS))', 'share of the grand total, through COLLAPSEALL'],
  ['l', 'isatlevel', 'ISATLEVEL([store])', 'ISATLEVEL of the lower level'],
  ['x', 'densify', '[Rev] * 1', 'DENSIFY: no cell left out'],
  ['x', 'rank', 'RANK(ORDERBY([Rev], DESC))', 'RANK with no axis, across two axes'],
  ['x', 'rank-columns', 'RANK(SKIP, COLUMNS, ORDERBY([Rev], DESC))', 'RANK along the columns'],
  ['x', 'runningsum', 'RUNNINGSUM([Rev])', 'RUNNINGSUM with no axis, across two axes'],
  ['x', 'runningsum-columns', 'RUNNINGSUM([Rev], COLUMNS)', 'RUNNINGSUM along the columns'],
  ['x', 'previous-columns', 'PREVIOUS([Rev], COLUMNS)', 'PREVIOUS along the columns'],
  ['x', 'collapse-columns', 'COLLAPSE([Rev], COLUMNS)', 'COLLAPSE the columns: the total of the row'],
];
write('visual', VISUALS.map(([s, name, calc, what, expect]) => [`visual-${s}-${name}`,
  `visual calculation, ${SHAPES[s].what}: ${what}${expect ? `
// expect: ${expect}` : ''}`, visual(SHAPES[s], calc)]));

// --- check: a row count per table ---
write('check', bim.tables.map(t => [`check-rows-${slug(t.name)}`, `the row count of ${t.name}`,
  `EVALUATE ROW("table", "${t.name}", "rows", COUNTROWS('${t.name}'))`]));
