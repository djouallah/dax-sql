SELECT cs_ship_addr_sk, SUM(cs_quantity) AS v
FROM catalog_sales
GROUP BY cs_ship_addr_sk
ORDER BY v DESC NULLS LAST, cs_ship_addr_sk NULLS FIRST
