-- every class with every ship mode; last year over every date: a sale whose date a year on is in
-- the calendar
WITH ly AS (
  SELECT i.i_class, sm.sm_type, SUM(cs.cs_quantity) AS q
  FROM catalog_sales cs
  JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  JOIN date_dim n ON n.d_date = (d.d_date + INTERVAL 1 YEAR)::DATE
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  LEFT JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk
  GROUP BY ALL
)
SELECT c.i_class, m.sm_type, ly.q AS m0
FROM (SELECT DISTINCT i_class FROM item) c
CROSS JOIN (SELECT DISTINCT sm_type FROM ship_mode) m
LEFT JOIN ly ON ly.i_class IS NOT DISTINCT FROM c.i_class AND ly.sm_type IS NOT DISTINCT FROM m.sm_type
