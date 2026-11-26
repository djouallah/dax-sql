-- per year, outside quarter 1: 1 when the average store profit (a fixed decimal, to 4 places) passes 1; the
-- largest catalog profit of a class
WITH s AS (
  SELECT d.d_year AS y, ROUND(AVG(ss.ss_net_profit::DOUBLE), 4) AS av
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_qoy <> 1
  GROUP BY ALL
), c AS (
  SELECT y, MAX(np) AS mx FROM (
    SELECT d.d_year AS y, i.i_class, SUM(cs.cs_net_profit) AS np
    FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk AND d.d_qoy <> 1
    JOIN item i ON i.i_item_sk = cs.cs_item_sk
    GROUP BY ALL)
  GROUP BY ALL
), t AS (
  SELECT g.d_year, CASE WHEN s.av > 1 THEN 1 END AS m0, c.mx AS m1
  FROM (SELECT DISTINCT d_year FROM date_dim WHERE d_qoy <> 1) g
  LEFT JOIN s ON s.y = g.d_year LEFT JOIN c ON c.y = g.d_year
)
SELECT * FROM t WHERE m0 IS NOT NULL OR m1 IS NOT NULL
