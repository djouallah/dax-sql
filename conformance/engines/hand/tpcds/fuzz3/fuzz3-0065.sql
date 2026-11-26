-- store sales know no ship mode: every type ties on the coral items' average store profit in quarters 1 and 2
-- (AVERAGE of a fixed decimal is one, to 4 places), so TOPN keeps them all
SELECT sm.sm_type, a.m0
FROM (SELECT DISTINCT sm_type FROM ship_mode) sm,
  (SELECT ABS(ROUND(AVG(ss.ss_net_profit::DOUBLE), 4)) AS m0
   FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_qoy IN (2, 1)
   JOIN item i ON i.i_item_sk = ss.ss_item_sk AND i.i_color = 'coral') a
WHERE a.m0 IS NOT NULL
