SELECT ss_quantity, SUM(ss_net_profit) AS v
FROM store_sales
WHERE ss_store_sk BETWEEN 1 AND 4
GROUP BY ss_quantity
