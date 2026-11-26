SELECT cs_ship_addr_sk, SUM(cs_net_profit) * 2 AS a, COALESCE(SUM(cs_net_profit), 0) + 1 AS b, COALESCE(SUM(cs_net_profit), 0) AS c
FROM catalog_sales
GROUP BY cs_ship_addr_sk
