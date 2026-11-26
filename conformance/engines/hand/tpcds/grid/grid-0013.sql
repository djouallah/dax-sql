SELECT ss_quantity, SUM(ss_net_profit) AS v
FROM store_sales
GROUP BY ss_quantity
