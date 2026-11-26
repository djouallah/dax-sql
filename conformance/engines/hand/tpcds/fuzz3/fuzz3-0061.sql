-- store sales know no ship mode: every ship mode type beside the khaki items' store revenue
SELECT sm.sm_type, r.rev AS m0
FROM (SELECT DISTINCT sm_type FROM ship_mode) sm,
  (SELECT SUM(ss.ss_ext_sales_price) AS rev
   FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk WHERE i.i_color = 'khaki') r
WHERE r.rev IS NOT NULL
