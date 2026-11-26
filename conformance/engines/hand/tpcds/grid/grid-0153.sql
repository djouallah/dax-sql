-- a blank compares as 0
SELECT cs_catalog_page_sk, SUM(cs_ext_sales_price)
FROM catalog_sales
WHERE COALESCE(cs_ext_list_price, 0) < 160.92 OR COALESCE(cs_ship_addr_sk, 0) <> 3
GROUP BY cs_catalog_page_sk
