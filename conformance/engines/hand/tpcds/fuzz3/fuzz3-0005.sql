-- the date window (1998) filters no item: the categories of each class, for every store name
-- (store and item are not related: every pair)
SELECT s.s_store_name, c.i_class, c.n AS m0
FROM (SELECT DISTINCT s_store_name FROM store) s
CROSS JOIN (SELECT i_class, COUNT(DISTINCT i_category) + MAX(CASE WHEN i_category IS NULL THEN 1 ELSE 0 END) AS n FROM item GROUP BY i_class) c
