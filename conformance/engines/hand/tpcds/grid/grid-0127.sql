SELECT ss_store_sk, SUM(ss_ext_sales_price)
FROM store_sales
WHERE ss_cdemo_sk IN (13, 11)
GROUP BY ss_store_sk
