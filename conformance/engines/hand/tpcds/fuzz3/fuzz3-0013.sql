-- every year x category (each with its blank row when some row's key misses the table: a sale without a date is
-- in the blank year): twice its catalog profit plus all catalog rows (COUNTROWS outside CALCULATE: no context
-- transition)
WITH np AS (
  SELECT d.d_year, i.i_category, SUM(cs.cs_net_profit) AS np
  FROM catalog_sales cs LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
), n AS (SELECT NULLIF(COUNT(*), 0) AS n FROM catalog_sales
), y AS (
  SELECT DISTINCT d_year FROM date_dim
  UNION SELECT NULL WHERE EXISTS (FROM store_sales ANTI JOIN date_dim ON d_date_sk_1 = ss_sold_date_sk)
                       OR EXISTS (FROM catalog_sales ANTI JOIN date_dim ON d_date_sk_1 = cs_sold_date_sk)
), c AS (
  SELECT DISTINCT i_category FROM item
  UNION SELECT NULL WHERE EXISTS (FROM store_sales ANTI JOIN item ON i_item_sk = ss_item_sk)
                       OR EXISTS (FROM catalog_sales ANTI JOIN item ON i_item_sk = cs_item_sk)
                       OR EXISTS (FROM promotion ANTI JOIN item ON i_item_sk = p_item_sk)
)
SELECT y.d_year, c.i_category, CASE WHEN np.np IS NULL AND n.n IS NULL THEN NULL ELSE COALESCE(2 * np.np, 0) + COALESCE(n.n, 0) END AS m0
FROM y CROSS JOIN c CROSS JOIN n
LEFT JOIN np ON np.d_year IS NOT DISTINCT FROM y.d_year AND np.i_category IS NOT DISTINCT FROM c.i_category
