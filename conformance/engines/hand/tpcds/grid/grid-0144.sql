SELECT i_item_sk, ss_addr_sk, SUM(ss_net_profit)
FROM store_sales JOIN item ON i_item_sk = ss_item_sk
GROUP BY i_item_sk, ss_addr_sk
