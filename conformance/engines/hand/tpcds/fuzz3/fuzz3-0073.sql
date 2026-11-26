-- per year, outside quarter 1 (the blank date, sales with no date, is outside it too): 1 when the average store
-- profit (a fixed decimal, to 4 places) passes 1; the largest catalog profit of a class
WITH s AS (
  SELECT d.d_year AS y, ROUND(AVG(ss.ss_net_profit::DOUBLE), 4) AS av
  FROM store_sales ss LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  WHERE d.d_qoy IS DISTINCT FROM 1
  GROUP BY ALL
), c AS (
  SELECT y, MAX(np) AS mx FROM (
    SELECT d.d_year AS y, i.i_class, SUM(cs.cs_net_profit) AS np
    FROM catalog_sales cs LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
    JOIN item i ON i.i_item_sk = cs.cs_item_sk
    WHERE d.d_qoy IS DISTINCT FROM 1
    GROUP BY ALL)
  GROUP BY ALL
)
SELECT COALESCE(s.y, c.y) AS d_year, CASE WHEN s.av > 1 THEN 1 END AS m0, c.mx AS m1
FROM s FULL JOIN c ON c.y IS NOT DISTINCT FROM s.y
WHERE m0 IS NOT NULL OR m1 IS NOT NULL
