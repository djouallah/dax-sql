SELECT cs_ship_addr_sk, SUM(cs_net_profit) AS a, SUM(cs_quantity) AS b
FROM catalog_sales
GROUP BY cs_ship_addr_sk
