-- one row: all catalog quantity (only the category filter kept, and there is none); the classes, when the average
-- store quantity (no CALCULATE: all rows) is over 1; the smallest catalog quantity
SELECT (SELECT SUM(cs_quantity) FROM catalog_sales) AS m0,
  CASE WHEN (SELECT AVG(ss_quantity) FROM store_sales) > 1
       THEN (SELECT COUNT(DISTINCT i_class) + MAX(CASE WHEN i_class IS NULL THEN 1 ELSE 0 END) FROM item) END AS m1,
  (SELECT MIN(cs_quantity) FROM catalog_sales) AS m2
