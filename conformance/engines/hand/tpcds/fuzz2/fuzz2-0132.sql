-- one row. m0: October, EXPRESS: the smallest over item colours of the colour's catalog revenue over the average
-- catalog profit of all colours (AVERAGE is not a measure: no context transition). m1: stores. m2: catalog
-- quantity a year back from every date
WITH ly AS (
  SELECT DISTINCT d.d_date_sk_1 AS sk
  FROM (SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
        UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)) x
  JOIN date_dim d ON d.d_date = x.dt
), c AS (
  SELECT i.i_color, cs.cs_ext_sales_price, cs.cs_net_profit
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk AND d.d_moy = 10
  JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk AND sm.sm_type = 'EXPRESS'
  JOIN item i ON i.i_item_sk = cs.cs_item_sk
)
SELECT (SELECT MIN(rev / NULLIF((SELECT ROUND(AVG(cs_net_profit), 4) FROM c), 0))
        FROM (SELECT i_color, SUM(cs_ext_sales_price) AS rev FROM c GROUP BY ALL)) AS m0,
  (SELECT COUNT(*) FROM store) AS m1,
  (SELECT SUM(cs_quantity) FROM catalog_sales WHERE cs_sold_date_sk IN (SELECT sk FROM ly)) AS m2
