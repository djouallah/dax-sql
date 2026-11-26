SELECT ss_store_sk, SUM(ss_ext_sales_price) AS v
FROM store_sales
GROUP BY ROLLUP (ss_store_sk)
ORDER BY ss_store_sk IS NULL, ss_store_sk, GROUPING(ss_store_sk)
