SELECT cs_catalog_page_sk, cs_ship_mode_sk, SUM(cs_quantity)
FROM catalog_sales
GROUP BY cs_catalog_page_sk, cs_ship_mode_sk
