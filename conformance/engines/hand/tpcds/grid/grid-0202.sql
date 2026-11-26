SELECT cs_catalog_page_sk, SUM(cs_net_profit) AS v
FROM catalog_sales
GROUP BY cs_catalog_page_sk
HAVING SUM(cs_net_profit) IS NOT NULL
