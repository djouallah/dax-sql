-- every year x category: catalog profit
WITH np AS (
  SELECT d.d_year, i.i_category, SUM(cs.cs_net_profit) AS np
  FROM catalog_sales cs LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
)
SELECT y.d_year, c.i_category, np.np AS m0
FROM (SELECT DISTINCT d_year FROM date_dim) y CROSS JOIN (SELECT DISTINCT i_category FROM item) c
LEFT JOIN np ON np.d_year IS NOT DISTINCT FROM y.d_year AND np.i_category IS NOT DISTINCT FROM c.i_category
