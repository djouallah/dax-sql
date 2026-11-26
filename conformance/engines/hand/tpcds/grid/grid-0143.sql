SELECT i_item_sk, SUM(ss_net_profit)
FROM store_sales JOIN item ON i_item_sk = ss_item_sk
WHERE ss_ext_list_price = 64.82
GROUP BY i_item_sk
