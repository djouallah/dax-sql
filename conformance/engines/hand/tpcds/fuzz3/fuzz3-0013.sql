-- every year x category: twice its catalog profit plus all catalog rows (COUNTROWS outside
-- CALCULATE: no context transition)
WITH np AS (
  SELECT d.d_year, i.i_category, SUM(cs.cs_net_profit) AS np
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
), n AS (SELECT NULLIF(COUNT(*), 0) AS n FROM catalog_sales)
SELECT y.d_year, c.i_category, CASE WHEN np.np IS NULL AND n.n IS NULL THEN NULL ELSE COALESCE(2 * np.np, 0) + COALESCE(n.n, 0) END AS m0
FROM (SELECT DISTINCT d_year FROM date_dim) y CROSS JOIN (SELECT DISTINCT i_category FROM item) c CROSS JOIN n
LEFT JOIN np ON np.d_year IS NOT DISTINCT FROM y.d_year AND np.i_category IS NOT DISTINCT FROM c.i_category
