SELECT cs_ship_addr_sk, SUM(cs_quantity) AS v
FROM catalog_sales
WHERE cs_ship_mode_sk IN (1, 5)
GROUP BY cs_ship_addr_sk
