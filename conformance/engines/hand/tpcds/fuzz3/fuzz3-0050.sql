-- ALLEXCEPT on an unfiltered store changes nothing; every existing price x color of item
-- (COUNTROWS(item) is never blank): catalog rows and items
WITH c AS (
  SELECT i.i_current_price, i.i_color, COUNT(*) AS n
  FROM catalog_sales cs LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
)
SELECT g.i_current_price, g.i_color, c.n AS m0, g.items AS m1
FROM (SELECT i_current_price, i_color, COUNT(*) AS items FROM item GROUP BY ALL) g
LEFT JOIN c ON c.i_current_price IS NOT DISTINCT FROM g.i_current_price AND c.i_color IS NOT DISTINCT FROM g.i_color
