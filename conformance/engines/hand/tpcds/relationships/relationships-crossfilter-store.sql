WITH sold AS (
  SELECT i.i_category, COUNT(DISTINCT s.s_store_sk) AS n
  FROM store_sales ss
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  JOIN store s ON s.s_store_sk = ss.ss_store_sk
  GROUP BY i.i_category)
SELECT c.i_category, (SELECT NULLIF(COUNT(*), 0) FROM store), sold.n
FROM (SELECT DISTINCT i_category FROM item) c
LEFT JOIN sold ON sold.i_category IS NOT DISTINCT FROM c.i_category
