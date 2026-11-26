-- brand scholarpack #6, class pants (or zz-none); per store name, brand and class pairs, and ship mode (every one:
-- m1 ranks MAX(cs_quantity), no measure, so the same for every quarter number: 1).
-- m0: the item colours whose store revenue YoY from 2025-03-02 to 2026-01-18 (each date a year back, a month's last
-- day also its month's) is over 1000; the quarter numbers where the catalog quantity YoY of those colours is over 1
WITH f AS (
  SELECT * FROM item WHERE i_class IN ('pants', 'zz-none') AND i_brand = 'scholarpack #6'
), sh AS (
  SELECT d_date AS dt, (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim
  UNION SELECT d_date, last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), rng AS (
  SELECT d_date_sk_1 AS sk FROM date_dim WHERE d_date BETWEEN DATE '2025-03-02' AND DATE '2026-01-18'
), rngly AS (
  SELECT DISTINCT d.d_date_sk_1 AS sk FROM sh JOIN date_dim d ON d.d_date = sh.ly WHERE sh.dt BETWEEN DATE '2025-03-02' AND DATE '2026-01-18'
), lyq AS (
  SELECT DISTINCT q.d_qoy, d.d_date_sk_1 AS sk FROM date_dim q JOIN sh ON sh.dt = q.d_date JOIN date_dim d ON d.d_date = sh.ly
), sr AS (
  SELECT st.s_store_name, f.i_brand, f.i_class, f.i_color,
    SUM(ss.ss_ext_sales_price) FILTER (WHERE ss.ss_sold_date_sk IN (SELECT sk FROM rng)) AS rev,
    SUM(ss.ss_ext_sales_price) FILTER (WHERE ss.ss_sold_date_sk IN (SELECT sk FROM rngly)) AS ly
  FROM store_sales ss JOIN f ON f.i_item_sk = ss.ss_item_sk JOIN store st ON st.s_store_sk = ss.ss_store_sk
  GROUP BY ALL
), k AS (
  -- per store name, brand and class: the colours whose store revenue YoY over the range is over 1000 (blank as 0)
  SELECT n.s_store_name, c.i_brand, c.i_class, c.i_color
  FROM (SELECT DISTINCT s_store_name FROM store) n CROSS JOIN (SELECT DISTINCT i_brand, i_class, i_color FROM f) c
  LEFT JOIN sr ON sr.s_store_name = n.s_store_name AND sr.i_brand = c.i_brand AND sr.i_class = c.i_class AND sr.i_color IS NOT DISTINCT FROM c.i_color
  WHERE COALESCE((COALESCE(sr.rev, 0) - sr.ly) / NULLIF(sr.ly, 0), 0) > 1000
), cq AS (
  SELECT k.s_store_name, k.i_brand, k.i_class, sm.sm_type, cs.cs_sold_date_sk AS sk, cs.cs_quantity AS q
  FROM catalog_sales cs JOIN f ON f.i_item_sk = cs.cs_item_sk
  JOIN k ON k.i_brand = f.i_brand AND k.i_class = f.i_class AND k.i_color IS NOT DISTINCT FROM f.i_color
  JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk
), yoy AS (
  SELECT g.s_store_name, g.i_brand, g.i_class, g.sm_type, q.d_qoy,
    (COALESCE((SELECT SUM(cq.q) FROM cq JOIN date_dim d ON d.d_date_sk_1 = cq.sk AND d.d_qoy = q.d_qoy
               WHERE cq.s_store_name = g.s_store_name AND cq.i_brand = g.i_brand AND cq.i_class = g.i_class AND cq.sm_type = g.sm_type), 0)
     - l.q) / NULLIF(l.q, 0) AS v
  FROM (SELECT DISTINCT s_store_name, i_brand, i_class, sm_type FROM cq) g CROSS JOIN (SELECT DISTINCT d_qoy FROM date_dim) q
  LEFT JOIN LATERAL (
    SELECT SUM(cq.q) AS q FROM cq JOIN lyq ON lyq.sk = cq.sk AND lyq.d_qoy = q.d_qoy
    WHERE cq.s_store_name = g.s_store_name AND cq.i_brand = g.i_brand AND cq.i_class = g.i_class AND cq.sm_type = g.sm_type) l ON TRUE
), m0 AS (
  SELECT s_store_name, i_brand, i_class, sm_type, COUNT(*) AS n FROM yoy WHERE COALESCE(v, 0) > 1 GROUP BY ALL
)
SELECT n.s_store_name, b.i_brand, t.sm_type, m0.n AS m0, 1 AS m1
FROM (SELECT DISTINCT s_store_name FROM store) n
CROSS JOIN (SELECT DISTINCT i_brand, i_class FROM f) b
CROSS JOIN (SELECT DISTINCT sm_type FROM ship_mode) t
LEFT JOIN m0 ON m0.s_store_name = n.s_store_name AND m0.i_brand = b.i_brand AND m0.i_class = b.i_class AND m0.sm_type = t.sm_type
