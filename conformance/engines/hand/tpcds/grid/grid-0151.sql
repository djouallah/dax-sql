SELECT cs_catalog_page_sk, SUM(cs_net_profit)
FROM catalog_sales
WHERE cs_bill_addr_sk IN (1, 2)
GROUP BY cs_catalog_page_sk
