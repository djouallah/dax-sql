-- per store city, the blank row's (store sales with no store) too: store profit; the catalog quantity's change over
-- a year (catalog sales know no store: all of it against every date a year back); the store revenue once per ship
-- mode type, the blank row's one when some catalog sale has no ship mode (ship modes filter no store sale)
WITH ly AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), y AS (
  SELECT (COALESCE(SUM(cs.cs_quantity), 0) - SUM(cs.cs_quantity) FILTER (WHERE d.d_date IN (SELECT dt FROM ly)))
    / NULLIF(SUM(cs.cs_quantity) FILTER (WHERE d.d_date IN (SELECT dt FROM ly)), 0) AS yoy
  FROM catalog_sales cs LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
), s AS (
  SELECT st.s_city, SUM(ss.ss_net_profit) AS np, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
  GROUP BY ALL
)
SELECT g.s_city, s.np AS m0, y.yoy AS m1, s.rev * (SELECT COUNT(*) FROM (SELECT sm_type FROM ship_mode
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM catalog_sales ANTI JOIN ship_mode ON sm_ship_mode_sk = cs_ship_mode_sk))) AS m2
FROM (SELECT s_city FROM store UNION SELECT s_city FROM s) g
LEFT JOIN s ON s.s_city IS NOT DISTINCT FROM g.s_city CROSS JOIN y
WHERE s.np IS NOT NULL OR y.yoy IS NOT NULL OR m2 IS NOT NULL
