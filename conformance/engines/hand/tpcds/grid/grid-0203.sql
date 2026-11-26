SELECT cs_ship_addr_sk, SUM(cs_net_profit) AS v
FROM catalog_sales
GROUP BY cs_ship_addr_sk
ORDER BY cs_ship_addr_sk NULLS FIRST
