-- per item colour: catalog quantity a year back from every date
WITH ly AS (
  SELECT DISTINCT d.d_date_sk_1 AS sk
  FROM (SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
        UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)) x
  JOIN date_dim d ON d.d_date = x.dt
), q AS (
  SELECT i.i_color, SUM(cs.cs_quantity) AS q
  FROM catalog_sales cs LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  WHERE cs.cs_sold_date_sk IN (SELECT sk FROM ly)
  GROUP BY ALL
)
SELECT c.i_color, q.q AS m0
FROM (SELECT DISTINCT i_color FROM item) c LEFT JOIN q ON q.i_color IS NOT DISTINCT FROM c.i_color
