-- the education statuses joined by commas, their length; 2025's dates a year back (2024, whole) of catalog
-- quantity; the addresses' distinct states (a promotion filters no address), blank counting once
SELECT
  (SELECT LENGTH(string_agg(cd_education_status, ',')) FROM (SELECT DISTINCT cd_education_status FROM customer_demographics)) AS m0,
  (SELECT SUM(cs.cs_quantity) FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
   WHERE d.d_date IN (SELECT (d_date - INTERVAL 1 YEAR)::DATE FROM date_dim WHERE d_year = 2025
                      UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_year = 2025 AND d_date = last_day(d_date))) AS m1,
  (SELECT COUNT(DISTINCT ca_state) + MAX((ca_state IS NULL)::INT) FROM customer_address) AS m2
