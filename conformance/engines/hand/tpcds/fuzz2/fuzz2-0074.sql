-- HASONEVALUE(s_state) with no store filter: the store table holds a single state
WITH one AS (SELECT COUNT(DISTINCT s_state) + (COUNT(*) > COUNT(s_state))::INT = 1 AS b FROM store),
g AS (
  SELECT i.i_class, sm.sm_type, ROUND(AVG(cs.cs_ext_sales_price), 4) AS a, SUM(cs.cs_net_profit) AS np
  FROM catalog_sales cs LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  LEFT JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk
  GROUP BY 1, 2)
SELECT i_class, sm_type, m0, m1 FROM (
  SELECT g.i_class, g.sm_type, CASE WHEN one.b THEN g.a END AS m0, g.np AS m1 FROM g, one)
WHERE m0 IS NOT NULL OR m1 IS NOT NULL
