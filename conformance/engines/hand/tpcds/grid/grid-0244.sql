SELECT SUM(cs_net_profit) AS v
FROM catalog_sales
WHERE cs_item_sk BETWEEN 1 AND 8
