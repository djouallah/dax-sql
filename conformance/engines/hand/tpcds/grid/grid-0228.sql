SELECT cs_ship_mode_sk, SUM(cs_ext_sales_price) AS v
FROM catalog_sales
GROUP BY ROLLUP (cs_ship_mode_sk)
ORDER BY cs_ship_mode_sk IS NULL, cs_ship_mode_sk NULLS FIRST, GROUPING(cs_ship_mode_sk)
