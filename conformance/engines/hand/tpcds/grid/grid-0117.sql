SELECT i_color, SUM(ss_net_profit)
FROM store_sales JOIN item ON i_item_sk = ss_item_sk
GROUP BY i_color
