-- under class pants: the group's cities counted over its distinct customers (blank with no sales);
-- the blank city is the stores of a NULL city and the sales of no store (store's blank row), and
-- its count is 1 when a store's city is a NULL (DISTINCTCOUNT counts that blank, not the blank row)
WITH dc AS (
  SELECT st.s_city AS c, COUNT(DISTINCT ss.ss_customer_sk) + MAX(CASE WHEN ss.ss_customer_sk IS NULL THEN 1 ELSE 0 END) AS n
  FROM store_sales ss
  JOIN item i ON i.i_item_sk = ss.ss_item_sk AND i.i_class = 'pants'
  LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
  GROUP BY 1
), k AS (
  SELECT DISTINCT s_city AS c FROM store
)
SELECT dc.c, 'pants', 1 / NULLIF(dc.n, 0)
FROM dc JOIN k ON k.c IS NOT DISTINCT FROM dc.c
