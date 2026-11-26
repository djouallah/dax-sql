-- store sales know no ship mode: every ship mode type (the blank row's too, when a catalog sale's ship mode is
-- missing) beside the smallest store quantity at price 40.25
WITH sm AS (
  SELECT DISTINCT sm_type FROM ship_mode
  UNION SELECT NULL WHERE EXISTS (FROM catalog_sales ANTI JOIN ship_mode ON sm_ship_mode_sk = cs_ship_mode_sk)
)
SELECT sm.sm_type, q.i_current_price, q.mn AS m0
FROM sm,
  (SELECT i.i_current_price, MIN(ss.ss_quantity) AS mn
   FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk
   WHERE i.i_current_price = 40.25 GROUP BY ALL HAVING MIN(ss.ss_quantity) IS NOT NULL) q
