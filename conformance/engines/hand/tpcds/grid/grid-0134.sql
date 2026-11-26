SELECT cs_catalog_page_sk, SUM(cs_quantity) AS v
FROM catalog_sales
GROUP BY cs_catalog_page_sk
ORDER BY v DESC NULLS LAST, cs_catalog_page_sk NULLS FIRST
