-- SELECTEDVALUE(i_color) is blank unless the items have one color: then blue gives store profit
WITH col AS (
  SELECT CASE WHEN COUNT(DISTINCT i_color) + MAX(CASE WHEN i_color IS NULL THEN 1 ELSE 0 END) = 1 THEN MIN(i_color) END AS color FROM item
)
SELECT (SELECT SUM(cs_quantity) FROM catalog_sales) AS m0,
       CASE WHEN col.color = 'blue' THEN (SELECT SUM(ss_net_profit) FROM store_sales)
            ELSE (SELECT round(AVG(cs_ext_sales_price), 4) FROM catalog_sales) END AS m1,
       (SELECT AVG(ss_quantity) FROM store_sales) AS m2
FROM col
