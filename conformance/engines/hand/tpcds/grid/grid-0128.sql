SELECT ss_store_sk, SUM(ss_ext_sales_price)
FROM store_sales
WHERE cache_buster IS NOT NULL AND ss_addr_sk = 2
GROUP BY ss_store_sk
