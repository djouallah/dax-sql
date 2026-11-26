SELECT cs_bill_cdemo_sk, SUM(cs_net_profit) AS v
FROM catalog_sales
GROUP BY cs_bill_cdemo_sk
HAVING SUM(cs_ext_sales_price) > 0
