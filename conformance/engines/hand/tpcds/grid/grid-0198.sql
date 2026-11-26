-- a blank compares as 0
SELECT cs_catalog_page_sk, SUM(cs_net_profit)
FROM catalog_sales
WHERE COALESCE(cs_ship_addr_sk, 0) <> 10 AND COALESCE(cs_ship_addr_sk, 0) < 12
GROUP BY cs_catalog_page_sk
