SELECT cs_ship_addr_sk, SUM(cs_net_profit) AS v
FROM catalog_sales
WHERE COALESCE(cs_quantity, 0) BETWEEN 1 AND 24
GROUP BY cs_ship_addr_sk
