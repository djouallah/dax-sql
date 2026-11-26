-- For the brand's items: per price and ship type, the largest catalog profit past 1 picks the price's store
-- revenue YoY (all dates against every date a year back; store_sales is not filtered by ship mode), else
-- the price's largest store profit
WITH it AS (SELECT * FROM item WHERE i_brand = 'eduuniv #3'),
ly AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)),
s AS (
  SELECT it.i_current_price AS p, MAX(ss.ss_net_profit) AS mp, SUM(ss.ss_ext_sales_price) AS rev,
    SUM(ss.ss_ext_sales_price) FILTER (WHERE d.d_date IN (SELECT dt FROM ly)) AS rly
  FROM store_sales ss JOIN it ON it.i_item_sk = ss.ss_item_sk LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY 1),
c AS (
  SELECT it.i_current_price AS p, sm.sm_type, MAX(cs.cs_net_profit) AS mp
  FROM catalog_sales cs JOIN it ON it.i_item_sk = cs.cs_item_sk LEFT JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk
  GROUP BY 1, 2),
t AS (
  SELECT g.p, g.sm_type,
    CASE WHEN COALESCE(c.mp, 0) > 1 THEN (COALESCE(s.rev, 0) - s.rly)::DOUBLE / NULLIF(s.rly, 0) ELSE s.mp END AS m0
  FROM (SELECT DISTINCT it.i_current_price AS p, sm.sm_type FROM it, ship_mode sm) g
  LEFT JOIN s ON s.p IS NOT DISTINCT FROM g.p
  LEFT JOIN c ON c.p IS NOT DISTINCT FROM g.p AND c.sm_type IS NOT DISTINCT FROM g.sm_type)
SELECT * FROM t WHERE m0 IS NOT NULL
