// The tpcds model's rows: a seeded generator in the shape of direct-lake-parquet-layout's TPC-DS
// mart (store_sales, catalog_sales and their dimensions), small enough to ship as M literals.
// The real tables hold SF10 or SF100; this sample holds a few hundred sales:
//
//   - date_dim is every day of 2024-2026, contiguous, so a year has the one before it for
//     SAMEPERIODLASTYEAR and TOTALYTD. d_date_sk_1, the facts' key, is a Julian-style number.
//   - The paper's report filters three rounds of slicers (paper_queries.json): a state, an
//     education status and a year, then a store manager, then a ship-mode carrier and a
//     catalog-page type. The dimensions hold each slicer's value, read from the captured
//     TREATAS calls, and each round has sales that pass all of its slicers, in its year and the
//     year before, so the visuals are not empty and their YoY not blank.
//   - cache_buster runs 0-3, so the captured `cache_buster < 2` keeps about half.
//   - Some sales lose money (a negative net profit).
//   - Half the catalog sales ship to another address and demographic than they bill, so the
//     inactive ship-side relationships answer differently from the active bill-side ones.
//   - Every foreign key is in its dimension: the model relies on referential integrity.
//
// Each table: rows as objects keyed by the source column names; build.mjs orders them by the
// model's columns. Dates are 'YYYY-MM-DD', date-times 'YYYY-MM-DD HH:MM:SS'.
import { readFileSync } from 'node:fs';

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86400000;
const iso = t => new Date(t).toISOString().slice(0, 10);
const ms = d => Date.parse(`${d}T00:00:00Z`);
const round = (x, n) => { const f = 10 ** n; return Math.round(x * f) / f; };

export const CALENDAR = ['2024-01-01', '2026-12-31'];

// The paper's slicers, per round: { round: { 'table[column]': value } }.
export function slicers() {
  const paper = JSON.parse(readFileSync(new URL('paper_queries.json', import.meta.url), 'utf8'));
  const out = {};
  for (const q of paper.queries) {
    const round = (out[q.slicer_state] ??= {});
    for (const [, v, t, c] of q.dax.matchAll(/TREATAS\(\{("[^"]*"|\d+)\}, '([^']+)'\[([^\]]+)\]\)/g))
      round[`${t}[${c}]`] = v.startsWith('"') ? v.slice(1, -1) : Number(v);
  }
  return out;
}

export function generate() {
  const rand = mulberry32(20261013);
  const pick = xs => xs[Math.floor(rand() * xs.length)];
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const ROUNDS = slicers();
  // A slicer's values, first, and then some the report never picks.
  const values = (key, more) => [...new Set([...Object.values(ROUNDS).map(r => r[key]).filter(v => v != null), ...more])];

  const date_dim = [];
  for (let t = ms(CALENDAR[0]), i = 0; t <= ms(CALENDAR[1]); t += DAY, i++) {
    const d = new Date(t), year = d.getUTCFullYear(), moy = d.getUTCMonth() + 1, qoy = Math.ceil(moy / 3);
    date_dim.push({ d_date_sk_1: 2460311 + i, d_date: iso(t), d_year: year, d_qoy: qoy, d_moy: moy,
      d_dow: d.getUTCDay(), d_dom: d.getUTCDate(), d_quarter_name: `${year}Q${qoy}` });
  }
  for (const [round, s] of Object.entries(ROUNDS))
    if (!date_dim.some(d => d.d_year === s['date_dim[d_year]'] - 1)) throw new Error(`round ${round}: no year before ${s['date_dim[d_year]']}`);

  const CATEGORIES = ['Books', 'Children', 'Electronics', 'Home', 'Jewelry', 'Men', 'Music', 'Shoes', 'Sports', 'Women'];
  const COLORS = ['almond', 'blue', 'coral', 'khaki', 'navy', 'olive', 'plum', 'snow'];
  const item = Array.from({ length: 16 }, (_, i) => {
    const price = round(1 + rand() * 90, 2);
    return { i_item_sk: i + 1, i_brand: `${pick(['amalg', 'edu', 'export', 'import', 'scholar'])}${pick(['maxi', 'pack', 'univ', 'corp'])} #${int(1, 9)}`,
      i_category: CATEGORIES[i % CATEGORIES.length], i_class: pick(['accessories', 'classical', 'dresses', 'fiction', 'pants', 'rock']),
      i_color: pick(COLORS), i_current_price: price, i_manufact: pick(['able', 'anti', 'bar', 'cally', 'eing', 'ought']),
      i_size: pick(['small', 'medium', 'large', 'extra large', 'N/A']), i_wholesale_cost: round(price * (0.3 + rand() * 0.5), 2) };
  });

  const MANAGERS = values('store[s_manager]', ['William Ward', 'Scott Smith', 'Edwin Adams', 'David Thomas']);
  const store = Array.from({ length: 6 }, (_, i) => ({
    s_store_sk: i + 1, s_city: pick(['Fairview', 'Midway', 'Oak Grove', 'Riverside']), s_county: pick(['Williamson County', 'Walker County', 'Ziebach County']),
    // The first manager the report picks runs two stores.
    s_manager: MANAGERS[i === 5 ? 0 : i % MANAGERS.length], s_market_manager: pick(['Julius Durham', 'Charles Jackson', 'Matthew Clifton']),
    s_state: pick(['TN', 'GA', 'TX']), s_store_name: ['ought', 'able', 'pri', 'ese', 'anti', 'cally'][i],
    s_tax_percentage: round(rand() * 0.11, 2), s_zip: String(int(30000, 79999)) }));

  const promotion = Array.from({ length: 10 }, (_, i) => ({
    p_promo_sk: i + 1, p_item_sk: pick(item).i_item_sk, p_cost: round(100 + rand() * 900, 2),
    p_promo_name: ['ought', 'able', 'pri', 'ese', 'anti', 'cally', 'eing', 'n st', 'bar', 'barought'][i] }));

  const CARRIERS = values('ship_mode[sm_carrier]', ['UPS', 'DHL', 'USPS', 'ZOUROS']);
  const ship_mode = CARRIERS.map((c, i) => ({ sm_ship_mode_sk: i + 1, sm_carrier: c, sm_code: pick(['AIR', 'SEA', 'SURFACE']),
    sm_type: ['EXPRESS', 'REGULAR', 'NEXT DAY', 'OVERNIGHT', 'TWO DAY'][i % 5] }));

  const PAGES = values('catalog_page[cp_type]', ['monthly', 'bi-annual']);
  const catalog_page = Array.from({ length: 6 }, (_, i) => ({ cp_catalog_page_sk: i + 1, cp_type: PAGES[i % PAGES.length] }));

  const STATES = values('customer_address[ca_state]', ['TX', 'GA']);
  const customer_address = Array.from({ length: STATES.length * 3 }, (_, i) => ({
    ca_address_sk: i + 1, ca_city: pick(['Clinton', 'Greenwood', 'Lakeside', 'Salem', 'Union']), ca_county: pick(['Franklin Parish', 'Barrow County', 'Luce County']),
    ca_location_type: pick(['apartment', 'condo', 'single family']), ca_state: STATES[i % STATES.length], ca_zip: String(int(10000, 99999)) }));

  const EDUCATION = values('customer_demographics[cd_education_status]', ['4 yr Degree', 'Primary', 'Secondary', 'Unknown']);
  const customer_demographics = EDUCATION.flatMap((e, i) => ['M', 'S'].map((m, j) => ({ cd_demo_sk: i * 2 + j + 1, cd_education_status: e, cd_marital_status: m })));

  // A dimension row passing a round's slicers on that table (any row when it has none).
  const within = (rows, table, s) => {
    const keep = rows.filter(r => Object.entries(s).every(([k, v]) => !k.startsWith(`${table}[`) || r[k.slice(table.length + 1, -1)] === v));
    if (!keep.length) throw new Error(`${table}: no row passes ${JSON.stringify(s)}`);
    return pick(keep);
  };
  const dayIn = year => pick(date_dim.filter(d => d.d_year === year)).d_date_sk_1;
  const money = (qty, list) => {
    const extList = round(qty * list, 2), extSales = round(extList * (0.5 + rand() * 0.5), 2);
    return [extList, extSales, round(extSales - extList * (0.55 + rand() * 0.35), 2)];
  };

  const store_sales = [], catalog_sales = [];
  const storeSale = (s, year) => {
    const qty = int(1, 20), list = round(1 + rand() * 120, 2), [extList, extSales, profit] = money(qty, list);
    store_sales.push({ cache_buster: int(0, 3), ss_addr_sk: within(customer_address, 'customer_address', s).ca_address_sk,
      ss_cdemo_sk: within(customer_demographics, 'customer_demographics', s).cd_demo_sk, ss_customer_sk: int(1, 40),
      ss_item_sk: pick(item).i_item_sk, ss_promo_sk: pick(promotion).p_promo_sk, ss_sold_date_sk: dayIn(year),
      ss_store_sk: within(store, 'store', s).s_store_sk, ss_ticket_number: store_sales.length + 1, ss_quantity: qty,
      ss_ext_list_price: extList, ss_ext_sales_price: extSales, ss_list_price: list, ss_net_profit: profit });
  };
  const catalogSale = (s, year) => {
    const qty = int(1, 50), list = round(1 + rand() * 200, 2), [extList, extSales, profit] = money(qty, list);
    const bill = within(customer_address, 'customer_address', s), billDemo = within(customer_demographics, 'customer_demographics', s);
    const elsewhere = rand() < 0.5;
    catalog_sales.push({ cache_buster: int(0, 3), cs_bill_addr_sk: bill.ca_address_sk, cs_bill_cdemo_sk: billDemo.cd_demo_sk,
      cs_catalog_page_sk: within(catalog_page, 'catalog_page', s).cp_catalog_page_sk, cs_item_sk: pick(item).i_item_sk,
      cs_promo_sk: pick(promotion).p_promo_sk, cs_ship_addr_sk: elsewhere ? pick(customer_address).ca_address_sk : bill.ca_address_sk,
      cs_ship_cdemo_sk: elsewhere ? pick(customer_demographics).cd_demo_sk : billDemo.cd_demo_sk,
      cs_ship_mode_sk: within(ship_mode, 'ship_mode', s).sm_ship_mode_sk, cs_sold_date_sk: dayIn(year),
      cs_order_number: catalog_sales.length + 1, cs_quantity: qty, cs_ext_list_price: extList, cs_ext_sales_price: extSales,
      cs_list_price: list, cs_net_profit: profit });
  };
  for (const s of Object.values(ROUNDS)) {
    const year = s['date_dim[d_year]'];
    for (let i = 0; i < 40; i++) storeSale(s, year);
    for (let i = 0; i < 20; i++) storeSale(s, year - 1);
    for (let i = 0; i < 30; i++) catalogSale(s, year);
    for (let i = 0; i < 15; i++) catalogSale(s, year - 1);
  }
  for (let i = 0; i < 200; i++) storeSale({}, pick([2024, 2025, 2026]));
  for (let i = 0; i < 150; i++) catalogSale({}, pick([2024, 2025, 2026]));

  const stg_tpcds_archive_log = ['store_sales', 'catalog_sales', 'date_dim', 'item', 'store'].map((t, i) => ({
    source_type: t.endsWith('_sales') ? 'fact' : 'dimension', source_filename: `${t}/part-00000.parquet`,
    archive_path: `Files/archive/tpcds/sf10/${t}/part-00000.parquet`, archived_at: `2026-09-0${i + 1} 0${i}:15:00`,
    row_count: { store_sales: store_sales.length, catalog_sales: catalog_sales.length, date_dim: date_dim.length, item: item.length, store: store.length }[t],
    etag: `sf10-${(0x1f3a + i * 977).toString(16)}`, file_stem: t }));

  return { date_dim, item, store, promotion, ship_mode, catalog_page, customer_address, customer_demographics,
    store_sales, catalog_sales, stg_tpcds_archive_log };
}
