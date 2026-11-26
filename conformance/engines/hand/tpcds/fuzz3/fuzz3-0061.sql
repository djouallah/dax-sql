-- store sales know no ship mode: every ship mode type (the blank row's too, when a catalog sale's ship mode is
-- missing) beside the khaki items' store revenue
WITH sm AS (
  SELECT DISTINCT sm_type FROM ship_mode
  UNION SELECT NULL WHERE EXISTS (FROM catalog_sales ANTI JOIN ship_mode ON sm_ship_mode_sk = cs_ship_mode_sk)
)
SELECT sm.sm_type, r.rev AS m0
FROM sm,
  (SELECT SUM(ss.ss_ext_sales_price) AS rev
   FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk WHERE i.i_color = 'khaki') r
WHERE r.rev IS NOT NULL
