SELECT cs_catalog_page_sk, SUM(cs_net_profit)
FROM catalog_sales
WHERE cs_list_price = 44.18
GROUP BY cs_catalog_page_sk
