SELECT ss_store_sk, SUM(ss_ext_sales_price)
FROM store_sales
GROUP BY ss_store_sk
HAVING SUM(ss_ext_sales_price) > 0
