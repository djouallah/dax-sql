-- per month: 0 when catalog has no profit that month, else the store profit; the two highest (ties kept)
WITH c AS (
  SELECT d.d_moy, SUM(cs.cs_net_profit) AS profit
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk GROUP BY ALL
), s AS (
  SELECT d.d_moy, SUM(ss.ss_net_profit) AS profit
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk GROUP BY ALL
), t AS (
  SELECT m.d_moy, CASE WHEN c.profit IS NULL THEN 0 ELSE s.profit END AS m0
  FROM (SELECT DISTINCT d_moy FROM date_dim) m
  LEFT JOIN c ON c.d_moy = m.d_moy LEFT JOIN s ON s.d_moy = m.d_moy
)
SELECT * FROM t WHERE m0 IS NOT NULL QUALIFY RANK() OVER (ORDER BY m0 DESC) <= 2
