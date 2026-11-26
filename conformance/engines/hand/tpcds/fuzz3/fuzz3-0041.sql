-- per month (sales with no date: blank): catalog quantity over the least store profit
WITH c AS (
  SELECT d.d_moy, SUM(cs.cs_quantity) AS qty FROM catalog_sales cs LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk GROUP BY ALL
), s AS (
  SELECT d.d_moy, MIN(ss.ss_net_profit) AS np_min FROM store_sales ss LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk GROUP BY ALL
)
SELECT c.d_moy, c.qty / NULLIF(s.np_min, 0) AS m0
FROM c JOIN s ON s.d_moy IS NOT DISTINCT FROM c.d_moy
WHERE c.qty IS NOT NULL AND NULLIF(s.np_min, 0) IS NOT NULL
