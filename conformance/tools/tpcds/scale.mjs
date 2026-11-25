// The tpcds model's tables at a TPC-DS scale factor, in a DuckDB file: DuckDB's dsdgen, each table
// as the model reads it (models/tpcds/model.bim), for timing the suite's tpcds queries on real
// volumes (tools/tpcds/scale-run.mjs). SF1: 2.9 million store sales, 1.4 million catalog sales.
//   node tools/tpcds/scale.mjs <sf> <out.duckdb>
// What differs from dsdgen's rows:
//   - the dates are 24 years later (sales 1998-2002 become 2022-2026, the years the paper's report
//     filters; 24 keeps every leap day one), and date_dim holds 2022-2027 only (contiguous);
//     d_dow and d_quarter_name are those of the later date;
//   - cache_buster, which TPC-DS lacks, is the ticket's (the order's) number mod 4;
//   - stg_tpcds_archive_log, not a TPC-DS table, is the sample's (models/tpcds/data).
import { existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const [sf, out] = process.argv.slice(2);
if (!sf || !out) throw new Error('usage: scale.mjs <sf> <out.duckdb>');
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { DuckDBInstance } = require('@duckdb/node-api');
const log = fileURLToPath(new URL('../../models/tpcds/data/stg_tpcds_archive_log.csv', import.meta.url));

const SHIFT = "INTERVAL 24 YEAR";
const tables = {
  date_dim: `SELECT d_date_sk AS d_date_sk_1, CAST(d_date + ${SHIFT} AS DATE) AS d_date, d_year + 24 AS d_year, d_qoy, d_moy,
      dayofweek(d_date + ${SHIFT}) AS d_dow, d_dom, (d_year + 24) || 'Q' || d_qoy AS d_quarter_name
    FROM date_dim WHERE d_year BETWEEN 1998 AND 2003`,
  item: `SELECT i_item_sk, i_brand, i_category, i_class, i_color, i_current_price, i_manufact, i_size, i_wholesale_cost FROM item`,
  store: `SELECT s_store_sk, s_city, s_county, s_manager, s_market_manager, s_state, s_store_name, s_tax_percentage, s_zip FROM store`,
  promotion: `SELECT p_promo_sk, p_item_sk, p_cost, p_promo_name FROM promotion`,
  ship_mode: `SELECT sm_ship_mode_sk, sm_carrier, sm_code, sm_type FROM ship_mode`,
  catalog_page: `SELECT cp_catalog_page_sk, cp_type FROM catalog_page`,
  customer_address: `SELECT ca_address_sk, ca_city, ca_county, ca_location_type, ca_state, ca_zip FROM customer_address`,
  customer_demographics: `SELECT cd_demo_sk, cd_education_status, cd_marital_status FROM customer_demographics`,
  store_sales: `SELECT ss_ticket_number % 4 AS cache_buster, ss_addr_sk, ss_cdemo_sk, ss_customer_sk, ss_item_sk, ss_promo_sk, ss_sold_date_sk,
      ss_store_sk, ss_ticket_number, ss_quantity, ss_ext_list_price, ss_ext_sales_price, ss_list_price, ss_net_profit FROM store_sales`,
  catalog_sales: `SELECT cs_order_number % 4 AS cache_buster, cs_bill_addr_sk, cs_bill_cdemo_sk, cs_catalog_page_sk, cs_item_sk, cs_promo_sk,
      cs_ship_addr_sk, cs_ship_cdemo_sk, cs_ship_mode_sk, cs_sold_date_sk, cs_order_number, cs_quantity, cs_ext_list_price,
      cs_ext_sales_price, cs_list_price, cs_net_profit FROM catalog_sales`,
};

for (const f of [out, `${out}.wal`]) if (existsSync(f)) rmSync(f);
const con = await (await DuckDBInstance.create(out)).connect();
const t0 = Date.now();
await con.run('INSTALL tpcds; LOAD tpcds');
await con.run(`ATTACH ':memory:' AS gen; USE gen; CALL dsdgen(sf = ${Number(sf)})`);
console.log(`dsdgen sf=${sf}: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
const db = out.replace(/\\/g, '/').split('/').pop().replace(/\.[^.]*$/, '');
for (const [name, sql] of Object.entries(tables)) {
  await con.run(`CREATE TABLE "${db}".main."${name}" AS ${sql}`);
  const n = (await con.runAndReadAll(`SELECT count(*) FROM "${db}".main."${name}"`)).getRows()[0][0];
  console.log(`${name}: ${n} rows`);
}
await con.run(`CREATE TABLE "${db}".main.stg_tpcds_archive_log AS SELECT * FROM read_csv('${log.replace(/\\/g, '/')}', header = true)`);
await con.run(`USE "${db}"; DETACH gen; CHECKPOINT`);
console.log(`${out}: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
