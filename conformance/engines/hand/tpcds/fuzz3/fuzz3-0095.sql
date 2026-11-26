-- the education statuses joined by commas (the blank row, when some sale has no demographic, an empty one), their length; 2025's dates a year back (2024, whole) of catalog
-- quantity; the addresses' distinct states (a promotion filters no address), blank counting once
SELECT
  (SELECT LENGTH(string_agg(COALESCE(cd_education_status, ''), ',')) FROM (SELECT cd_education_status FROM customer_demographics
     UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales ANTI JOIN customer_demographics ON cd_demo_sk = ss_cdemo_sk)
       OR EXISTS (SELECT 1 FROM catalog_sales ANTI JOIN customer_demographics ON cd_demo_sk = cs_bill_cdemo_sk)
       OR EXISTS (SELECT 1 FROM catalog_sales ANTI JOIN customer_demographics ON cd_demo_sk = cs_ship_cdemo_sk))) AS m0,
  (SELECT SUM(cs.cs_quantity) FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
   WHERE d.d_date IN (SELECT (d_date - INTERVAL 1 YEAR)::DATE FROM date_dim WHERE d_year = 2025
                      UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_year = 2025 AND d_date = last_day(d_date))) AS m1,
  (SELECT COUNT(DISTINCT ca_state) + MAX((ca_state IS NULL)::INT) FROM customer_address) AS m2
