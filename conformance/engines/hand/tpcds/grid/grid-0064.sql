SELECT ss_item_sk, SUM(ss_ext_sales_price) AS v
FROM store_sales
GROUP BY ROLLUP (ss_item_sk)
ORDER BY ss_item_sk IS NULL, ss_item_sk, GROUPING(ss_item_sk)
