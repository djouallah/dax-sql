SELECT s_manager, SUM(ss_ext_sales_price)
FROM store_sales JOIN store ON s_store_sk = ss_store_sk
GROUP BY s_manager
