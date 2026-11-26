SELECT cs_catalog_page_sk, SUM(cs_quantity)
FROM catalog_sales
GROUP BY cs_catalog_page_sk
HAVING SUM(cs_ext_sales_price) > 0
