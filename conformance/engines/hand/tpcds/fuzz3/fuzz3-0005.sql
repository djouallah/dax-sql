-- the date window (1998) filters no item: the categories of each class, for every store name and the store's
-- blank row (when a store sale's store is missing; store and item are not related: every pair)
WITH s AS (
  SELECT DISTINCT s_store_name FROM store
  UNION SELECT NULL WHERE EXISTS (FROM store_sales ANTI JOIN store ON s_store_sk = ss_store_sk)
)
SELECT s.s_store_name, c.i_class, c.n AS m0
FROM s
CROSS JOIN (SELECT i_class, COUNT(DISTINCT i_category) + MAX(CASE WHEN i_category IS NULL THEN 1 ELSE 0 END) AS n FROM item GROUP BY i_class) c
