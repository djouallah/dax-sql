SELECT cs_catalog_page_sk, SUM(cs_quantity)
FROM catalog_sales
GROUP BY cs_catalog_page_sk
ORDER BY cs_catalog_page_sk NULLS FIRST
