SELECT ss_store_sk, (SUM(ss_ext_sales_price)) * 2 AS a, COALESCE(SUM(ss_ext_sales_price), 0) + 1 AS b, COALESCE(SUM(ss_ext_sales_price), 0) AS c
FROM store_sales
GROUP BY ss_store_sk
