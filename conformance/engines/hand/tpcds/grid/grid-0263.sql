SELECT cs_bill_cdemo_sk, SUM(cs_quantity) AS v
FROM catalog_sales
WHERE cs_order_number IN (261, 222)
GROUP BY cs_bill_cdemo_sk
