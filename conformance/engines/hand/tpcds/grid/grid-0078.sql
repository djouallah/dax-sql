SELECT ss_store_sk, ss_quantity, SUM(ss_ext_sales_price) AS v
FROM store_sales
GROUP BY ss_store_sk, ss_quantity
