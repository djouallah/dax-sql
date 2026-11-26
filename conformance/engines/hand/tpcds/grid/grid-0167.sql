-- a blank compares as 0
SELECT s_manager, SUM(ss_net_profit)
FROM store_sales JOIN store ON s_store_sk = ss_store_sk
WHERE COALESCE(ss_customer_sk, 0) <> 29
GROUP BY s_manager
