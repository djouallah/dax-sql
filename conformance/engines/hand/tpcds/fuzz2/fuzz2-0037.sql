-- the item categories, each with its store net profit
SELECT c.i_category, p.np AS m0
FROM (SELECT DISTINCT i_category FROM item) c
LEFT JOIN (
  SELECT i.i_category, SUM(ss.ss_net_profit) AS np
  FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk GROUP BY ALL
) p ON p.i_category IS NOT DISTINCT FROM c.i_category
