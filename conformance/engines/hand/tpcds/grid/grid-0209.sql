SELECT cs_catalog_page_sk, SUM(cs_ext_sales_price) AS v
FROM catalog_sales
WHERE cs_item_sk IS NOT NULL
GROUP BY cs_catalog_page_sk
