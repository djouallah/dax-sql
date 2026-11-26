-- items of any colour but navy (a blank colour kept); per class and price (colour is not in scope): store profit, and
-- the number of store cities over the average store quantity
SELECT i.i_class, i.i_current_price, SUM(ss.ss_net_profit) AS m0,
  (SELECT COUNT(DISTINCT s_city) + MAX(CASE WHEN s_city IS NULL THEN 1 ELSE 0 END) FROM store) / NULLIF(AVG(ss.ss_quantity), 0) AS m1
FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk AND i.i_color IS DISTINCT FROM 'navy'
GROUP BY ALL
HAVING m0 IS NOT NULL OR m1 IS NOT NULL
