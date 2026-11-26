SELECT cs_ship_addr_sk, SUM(cs_quantity) AS v
FROM catalog_sales
WHERE COALESCE(cs_catalog_page_sk, 0) <> 6 OR NOT (COALESCE(cs_order_number, 0) = 143)
GROUP BY cs_ship_addr_sk
