-- per month and ship mode: catalog profit, and the number of cities (a store filters no catalog sale) when the
-- largest catalog quantity of the ship mode, from 1 January of the month's last date's year to that date, is over 10
WITH ytd AS (
  SELECT d_moy, date_trunc('year', MAX(d_date))::DATE AS d0, MAX(d_date) AS d1 FROM date_dim GROUP BY ALL
), c AS (
  SELECT sm.sm_type, d.d_date, d.d_moy, cs.cs_quantity, cs.cs_net_profit
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  LEFT JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk
), np AS (
  SELECT sm_type, d_moy, SUM(cs_net_profit) AS np FROM c GROUP BY ALL
), mx AS (
  SELECT ytd.d_moy, c.sm_type, MAX(c.cs_quantity) AS mq FROM ytd JOIN c ON c.d_date BETWEEN ytd.d0 AND ytd.d1 GROUP BY ALL
)
SELECT m.d_moy, t.sm_type, np.np AS m0,
  CASE WHEN mx.mq > 10 THEN (SELECT COUNT(DISTINCT s_city) + MAX(CASE WHEN s_city IS NULL THEN 1 ELSE 0 END) FROM store) END AS m1
FROM (SELECT DISTINCT d_moy FROM date_dim) m CROSS JOIN (SELECT DISTINCT sm_type FROM ship_mode) t
LEFT JOIN np ON np.d_moy = m.d_moy AND np.sm_type IS NOT DISTINCT FROM t.sm_type
LEFT JOIN mx ON mx.d_moy = m.d_moy AND mx.sm_type IS NOT DISTINCT FROM t.sm_type
WHERE m0 IS NOT NULL OR m1 IS NOT NULL
