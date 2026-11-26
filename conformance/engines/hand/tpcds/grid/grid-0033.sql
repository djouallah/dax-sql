SELECT SUM(ss_net_profit) AS v
FROM store_sales
WHERE ss_item_sk IN (6, 11)
