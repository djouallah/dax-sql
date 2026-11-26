SELECT cs_bill_cdemo_sk, SUM(cs_quantity) AS a, SUM(cs_net_profit) AS b
FROM catalog_sales
GROUP BY cs_bill_cdemo_sk
