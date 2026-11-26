SELECT ss_store_sk, SUM(ss_ext_sales_price)
FROM store_sales
WHERE ss_ext_list_price = 996.5
GROUP BY ss_store_sk
