-- one row: catalog quantity a year back from every date; the average over years of SUM(cs_ext_sales_price) with no
-- CALCULATE (all of it each time); the smallest store quantity (the catalog's relationship changes nothing there)
WITH ly AS (
  SELECT DISTINCT d.d_date_sk_1 AS sk
  FROM (SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
        UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)) x
  JOIN date_dim d ON d.d_date = x.dt
)
SELECT (SELECT SUM(cs_quantity) FROM catalog_sales WHERE cs_sold_date_sk IN (SELECT sk FROM ly)) AS m0,
  (SELECT SUM(cs_ext_sales_price) FROM catalog_sales) AS m1,
  (SELECT MIN(ss_quantity) FROM store_sales) AS m2
