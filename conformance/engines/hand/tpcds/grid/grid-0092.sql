SELECT ss_store_sk, SUM(ss_ext_sales_price) AS v
FROM store_sales
GROUP BY ss_store_sk
