SELECT ss_store_sk, SUM(ss_net_profit)
FROM store_sales
GROUP BY ss_store_sk
ORDER BY ss_store_sk NULLS FIRST
