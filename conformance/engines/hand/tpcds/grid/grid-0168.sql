SELECT s_manager, ss_cdemo_sk, SUM(ss_ext_sales_price)
FROM store_sales JOIN store ON s_store_sk = ss_store_sk
GROUP BY s_manager, ss_cdemo_sk
