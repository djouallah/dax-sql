SELECT o.s_market_manager, SUM(f.ss_ext_sales_price) AS v
FROM store_sales f JOIN store o ON o.s_store_sk = f.ss_store_sk
WHERE o.s_manager IS NOT NULL
GROUP BY o.s_market_manager
