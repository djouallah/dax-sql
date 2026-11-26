SELECT cache_buster, SUM(cs_quantity) AS v
FROM catalog_sales
GROUP BY ROLLUP (cache_buster)
ORDER BY cache_buster IS NULL, cache_buster NULLS FIRST, GROUPING(cache_buster)
