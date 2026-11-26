-- year to date of the last date (TOTALYTD over every date), the average profit rounded, and the
-- marital statuses times the states
WITH last AS (SELECT max(d_date) AS dt FROM date_dim)
SELECT
  (SELECT SUM(ss.ss_ext_sales_price) FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk, last
   WHERE d.d_date BETWEEN date_trunc('year', last.dt) AND last.dt) AS m0,
  (SELECT round(AVG(ss_net_profit), 2) FROM store_sales) AS m1,
  (SELECT NULLIF(COUNT(*), 0) FROM (SELECT DISTINCT cd_marital_status FROM customer_demographics) CROSS JOIN (SELECT DISTINCT ca_state FROM customer_address)) AS m2
