SELECT cs_bill_cdemo_sk, SUM(cs_quantity)
FROM catalog_sales
GROUP BY cs_bill_cdemo_sk
