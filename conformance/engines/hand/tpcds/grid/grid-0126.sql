SELECT ss_store_sk, ss_item_sk, SUM(ss_net_profit)
FROM store_sales
GROUP BY ss_store_sk, ss_item_sk
