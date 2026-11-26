SELECT cs_bill_cdemo_sk, SUM(cs_quantity)
FROM catalog_sales
WHERE cs_item_sk IS NOT NULL
GROUP BY cs_bill_cdemo_sk
