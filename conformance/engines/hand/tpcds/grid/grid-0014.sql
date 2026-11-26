SELECT cache_buster, SUM(ss_net_profit) AS v
FROM store_sales
GROUP BY ROLLUP (cache_buster)
ORDER BY cache_buster IS NULL, cache_buster, GROUPING(cache_buster)
