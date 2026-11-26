-- per ship mode type (the blank one too: a catalog sale with no or an unknown ship mode): all store revenue
-- (store_sales is not related to ship_mode), rounded to units
SELECT sm_type, (SELECT ABS(ROUND(SUM(ss_ext_sales_price), 0)) FROM store_sales) AS m0
FROM (
  SELECT DISTINCT sm_type FROM ship_mode
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM catalog_sales WHERE cs_ship_mode_sk IS NULL OR cs_ship_mode_sk NOT IN (SELECT sm_ship_mode_sk FROM ship_mode))
)
