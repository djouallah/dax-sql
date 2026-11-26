SELECT cs_catalog_page_sk, SUM(cs_quantity)
FROM catalog_sales
WHERE cs_ship_addr_sk IN (6, 15)
GROUP BY cs_catalog_page_sk
