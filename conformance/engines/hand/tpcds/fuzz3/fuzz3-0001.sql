-- year to date of the last date (TOTALYTD over every date), the average profit rounded, and the
-- marital statuses times the states (each with its blank row when some sale's key misses the table)
WITH last AS (SELECT max(d_date) AS dt FROM date_dim), ms AS (
  SELECT DISTINCT cd_marital_status FROM customer_demographics
  UNION SELECT NULL WHERE EXISTS (FROM store_sales ANTI JOIN customer_demographics ON cd_demo_sk = ss_cdemo_sk)
                       OR EXISTS (FROM catalog_sales ANTI JOIN customer_demographics ON cd_demo_sk = cs_bill_cdemo_sk)
                       OR EXISTS (FROM catalog_sales ANTI JOIN customer_demographics ON cd_demo_sk = cs_ship_cdemo_sk)
), st AS (
  SELECT DISTINCT ca_state FROM customer_address
  UNION SELECT NULL WHERE EXISTS (FROM store_sales ANTI JOIN customer_address ON ca_address_sk = ss_addr_sk)
                       OR EXISTS (FROM catalog_sales ANTI JOIN customer_address ON ca_address_sk = cs_bill_addr_sk)
                       OR EXISTS (FROM catalog_sales ANTI JOIN customer_address ON ca_address_sk = cs_ship_addr_sk)
)
SELECT
  (SELECT SUM(ss.ss_ext_sales_price) FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk, last
   WHERE d.d_date BETWEEN date_trunc('year', last.dt) AND last.dt) AS m0,
  (SELECT round(AVG(ss_net_profit), 2) FROM store_sales) AS m1,
  (SELECT NULLIF(COUNT(*), 0) FROM ms CROSS JOIN st) AS m2
