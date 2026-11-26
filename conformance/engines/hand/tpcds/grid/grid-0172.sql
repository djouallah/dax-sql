SELECT cs_catalog_page_sk, SUM(cs_net_profit)
FROM catalog_sales
GROUP BY cs_catalog_page_sk
