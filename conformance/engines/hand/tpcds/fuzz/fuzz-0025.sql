-- the dates to 2025-10-02: catalog quantity of those dates a year back over the store profit of those dates
WITH dates AS (
  SELECT d_date FROM date_dim WHERE d_date BETWEEN DATE '1999-01-01' AND DATE '2025-10-02'
), shift AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM dates
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM dates WHERE d_date = last_day(d_date)
), t AS (
  SELECT
    (SELECT SUM(cs.cs_quantity) FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
     WHERE d.d_date IN (SELECT ly FROM shift))
    / NULLIF((SELECT SUM(ss.ss_net_profit) FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
              WHERE d.d_date IN (SELECT d_date FROM dates)), 0) AS m0,
    (SELECT MAX(cs_quantity) FROM catalog_sales) AS m1
)
SELECT * FROM t WHERE m0 IS NOT NULL OR m1 IS NOT NULL
