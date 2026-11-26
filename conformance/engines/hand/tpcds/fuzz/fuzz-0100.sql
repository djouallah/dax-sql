-- under class pants: the group's city counted (1) over its distinct customers (blank with no sales)
WITH dc AS (
  SELECT st.s_city AS c, COUNT(DISTINCT ss.ss_customer_sk) + MAX(CASE WHEN ss.ss_customer_sk IS NULL THEN 1 ELSE 0 END) AS n
  FROM store_sales ss
  JOIN item i ON i.i_item_sk = ss.ss_item_sk AND i.i_class = 'pants'
  JOIN store st ON st.s_store_sk = ss.ss_store_sk
  GROUP BY 1
)
SELECT g.c, 'pants', 1 / NULLIF(dc.n, 0)
FROM (SELECT DISTINCT s_city AS c FROM store) g
JOIN dc ON dc.c = g.c
WHERE EXISTS (SELECT 1 FROM item WHERE i_class = 'pants')
