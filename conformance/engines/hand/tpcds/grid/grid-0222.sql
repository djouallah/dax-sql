SELECT SUM(cs_quantity) AS v
FROM catalog_sales
WHERE cs_quantity IN (35, 42)
