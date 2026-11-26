-- every year: its distinct customers (a missing customer one more value); the items are not
-- filtered by the dates: every class joined by ",". Years and classes include the blank row when a sale has no
-- date, a sale or a promotion no item (an empty class)
WITH s AS (
  SELECT d.d_year, COUNT(DISTINCT ss.ss_customer_sk) + MAX((ss.ss_customer_sk IS NULL)::INT) AS dc
  FROM store_sales ss LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk GROUP BY ALL
)
SELECT y.d_year, s.dc AS m0,
  (SELECT SUM(LENGTH(COALESCE(i_class, ''))) + COUNT(*) - 1 FROM (SELECT i_class FROM item
     UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales ANTI JOIN item ON i_item_sk = ss_item_sk)
       OR EXISTS (SELECT 1 FROM catalog_sales ANTI JOIN item ON i_item_sk = cs_item_sk)
       OR EXISTS (SELECT 1 FROM promotion ANTI JOIN item ON i_item_sk = p_item_sk))) AS m1
FROM (SELECT d_year FROM date_dim
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales ANTI JOIN date_dim ON d_date_sk_1 = ss_sold_date_sk)
    OR EXISTS (SELECT 1 FROM catalog_sales ANTI JOIN date_dim ON d_date_sk_1 = cs_sold_date_sk)) y
LEFT JOIN s ON s.d_year IS NOT DISTINCT FROM y.d_year
