-- per ship mode (filters no item or store sale): store revenue of the items priced 36.64, when they hold one category
WITH i AS (
  SELECT * FROM item WHERE i_current_price = 36.64
), v AS (
  SELECT CASE WHEN (SELECT COUNT(DISTINCT i_category) + MAX(CASE WHEN i_category IS NULL THEN 1 ELSE 0 END) FROM i) = 1
              THEN (SELECT SUM(ss_ext_sales_price) FROM store_sales WHERE ss_item_sk IN (SELECT i_item_sk FROM i)) END AS m0
)
SELECT t.sm_type, v.m0 FROM (SELECT DISTINCT sm_type FROM ship_mode) t CROSS JOIN v
