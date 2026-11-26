SELECT cs_catalog_page_sk, cs_item_sk, SUM(cs_ext_sales_price)
FROM catalog_sales
GROUP BY cs_catalog_page_sk, cs_item_sk
