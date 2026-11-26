SELECT ss_store_sk, SUM(ss_net_profit) AS v
FROM store_sales
WHERE COALESCE(ss_list_price, 0) < 32.28
GROUP BY ss_store_sk
