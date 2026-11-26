-- per ship mode (filters no item or store sale; the blank row's too, when a catalog sale's ship mode is missing):
-- store revenue of the items priced 36.64, when they hold one category
WITH i AS (
  SELECT * FROM item WHERE i_current_price = 36.64
), v AS (
  SELECT CASE WHEN (SELECT COUNT(DISTINCT i_category) + MAX(CASE WHEN i_category IS NULL THEN 1 ELSE 0 END) FROM i) = 1
              THEN (SELECT SUM(ss_ext_sales_price) FROM store_sales WHERE ss_item_sk IN (SELECT i_item_sk FROM i)) END AS m0
), t AS (
  SELECT DISTINCT sm_type FROM ship_mode
  UNION SELECT NULL WHERE EXISTS (FROM catalog_sales ANTI JOIN ship_mode ON sm_ship_mode_sk = cs_ship_mode_sk)
)
SELECT t.sm_type, v.m0 FROM t CROSS JOIN v
