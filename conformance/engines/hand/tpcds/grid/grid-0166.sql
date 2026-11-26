SELECT s_manager, SUM(ss_ext_sales_price)
FROM store_sales JOIN store ON s_store_sk = ss_store_sk
WHERE s_market_manager IS NOT NULL
GROUP BY s_manager
