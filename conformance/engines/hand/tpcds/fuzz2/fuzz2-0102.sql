-- the catalog side is never blank (a YoY minus a count of states), so m0 = m1 = store revenue YoY per city, two
-- brands, the dates of every month but February (FILTER(ALL(d_moy)): no blank month, so no sale without a date);
-- last year = each such date a year back (a month's last day also its month's)
WITH ctx AS (
  SELECT d_date_sk_1 AS sk, d_date FROM date_dim WHERE d_moy <> 2
), ly AS (
  SELECT DISTINCT d.d_date_sk_1 AS sk
  FROM (SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM ctx
        UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM ctx WHERE d_date = last_day(d_date)) x
  JOIN date_dim d ON d.d_date = x.dt
), f AS (
  SELECT st.s_city, ss.ss_sold_date_sk AS sk, ss.ss_ext_sales_price AS p
  FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk AND i.i_brand IN ('importcorp #1', 'exportcorp #7')
  LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
), r AS (
  SELECT s_city,
    SUM(p) FILTER (WHERE sk IN (SELECT sk FROM ctx)) AS rev,
    SUM(p) FILTER (WHERE sk IN (SELECT sk FROM ly)) AS ly
  FROM f GROUP BY ALL
)
SELECT s_city, (COALESCE(rev, 0) - ly) / NULLIF(ly, 0) AS m0, m0 AS m1
FROM r
WHERE m0 IS NOT NULL
