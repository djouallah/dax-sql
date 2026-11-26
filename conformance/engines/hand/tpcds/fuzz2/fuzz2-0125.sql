-- HASONEVALUE(d_moy) with no date filter: true only when the date table holds a single month
SELECT AVG(cs_quantity) AS m0
FROM catalog_sales
WHERE (SELECT COUNT(DISTINCT d_moy) FROM date_dim) = 1
HAVING m0 IS NOT NULL
