-- per category and quarter number (every pair: m1, the count of education statuses, is never blank):
-- catalog rows over store profit (all promotions)
WITH c AS (
  SELECT i.i_category, d.d_qoy, COUNT(*) AS n
  FROM catalog_sales cs JOIN item i ON i.i_item_sk = cs.cs_item_sk JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY ALL
), s AS (
  SELECT i.i_category, d.d_qoy, SUM(ss.ss_net_profit) AS np
  FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
)
SELECT k.i_category, q.d_qoy, c.n / NULLIF(s.np, 0) AS m0,
  (SELECT COUNT(DISTINCT cd_education_status) + MAX(CASE WHEN cd_education_status IS NULL THEN 1 ELSE 0 END) FROM customer_demographics) AS m1
FROM (SELECT DISTINCT i_category FROM item) k CROSS JOIN (SELECT DISTINCT d_qoy FROM date_dim) q
LEFT JOIN c ON c.i_category IS NOT DISTINCT FROM k.i_category AND c.d_qoy = q.d_qoy
LEFT JOIN s ON s.i_category IS NOT DISTINCT FROM k.i_category AND s.d_qoy = q.d_qoy
