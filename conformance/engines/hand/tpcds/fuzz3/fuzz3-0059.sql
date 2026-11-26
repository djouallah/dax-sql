-- store sales know no ship mode: every ship mode type beside the smallest store quantity at price 40.25
SELECT sm.sm_type, q.i_current_price, q.mn AS m0
FROM (SELECT DISTINCT sm_type FROM ship_mode) sm,
  (SELECT i.i_current_price, MIN(ss.ss_quantity) AS mn
   FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk
   WHERE i.i_current_price = 40.25 GROUP BY ALL HAVING MIN(ss.ss_quantity) IS NOT NULL) q
