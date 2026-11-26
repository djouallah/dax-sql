SELECT SUM(cs_net_profit) AS v
FROM catalog_sales
WHERE COALESCE(cs_ship_cdemo_sk, 0) < 11
