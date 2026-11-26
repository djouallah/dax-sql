-- per ship mode (m0 is never blank: every ship mode type, and the blank one when some catalog sale has no ship
-- mode): the quarters of the date table (4);
-- m1: the ship mode's highest catalog profit when the three cities sold in store (0 when not, blank when no
-- class has a store profit); m2: catalog quantity against the dates a year back
WITH shift AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), c AS (
  SELECT sm.sm_type, MAX(cs.cs_net_profit) AS mx, SUM(cs.cs_quantity) AS qty,
    SUM(cs.cs_quantity) FILTER (WHERE d.d_date IN (SELECT ly FROM shift)) AS ly
  FROM catalog_sales cs
  LEFT JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY sm.sm_type
), g AS (
  SELECT sm_type FROM ship_mode
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM catalog_sales WHERE cs_ship_mode_sk IS NULL OR cs_ship_mode_sk NOT IN (SELECT sm_ship_mode_sk FROM ship_mode))
), s AS (
  SELECT (SELECT COUNT(ss_net_profit) > 0 FROM store_sales) AS any_profit,
    (SELECT SUM(ss.ss_ext_sales_price) FROM store_sales ss JOIN store st ON st.s_store_sk = ss.ss_store_sk
     WHERE st.s_city IN ('Fairview', 'Oak Grove', 'Midway')) AS city_rev,
    (SELECT COUNT(DISTINCT d_qoy) + (COUNT(*) > COUNT(d_qoy))::INT FROM date_dim) AS qoys
)
SELECT g.sm_type, s.qoys AS m0,
  CASE WHEN NOT s.any_profit THEN 0 WHEN s.city_rev IS NULL THEN 0 ELSE c.mx END AS m1,
  (COALESCE(c.qty, 0) - c.ly) / NULLIF(c.ly, 0) AS m2
FROM g CROSS JOIN s LEFT JOIN c ON c.sm_type IS NOT DISTINCT FROM g.sm_type
