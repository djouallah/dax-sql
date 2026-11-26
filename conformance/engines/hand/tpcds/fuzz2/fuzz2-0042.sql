-- the item categories (a row context: the bare aggregates see every row): the rank of one shared
-- average (1), and all store revenue + every category
SELECT c.i_category, 1 AS m0,
  (SELECT SUM(ss_ext_sales_price) FROM store_sales)
    + (SELECT COUNT(DISTINCT i_category) + MAX(CASE WHEN i_category IS NULL THEN 1 ELSE 0 END) FROM item) AS m1
FROM (SELECT DISTINCT i_category FROM item) c
