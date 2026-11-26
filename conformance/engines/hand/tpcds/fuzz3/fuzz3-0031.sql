-- the largest store profit per color (sales with no item: blank); the lowest of them (ties kept)
WITH m AS (
  SELECT i.i_color, MAX(ss.ss_net_profit) AS m0
  FROM store_sales ss LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  GROUP BY ALL
  HAVING MAX(ss.ss_net_profit) IS NOT NULL
)
SELECT i_color, m0 FROM m QUALIFY rank() OVER (ORDER BY m0) <= 1
