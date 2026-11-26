SELECT cs_bill_cdemo_sk, SUM(cs_ext_sales_price) AS v
FROM catalog_sales
WHERE cs_bill_cdemo_sk IS NOT NULL
GROUP BY cs_bill_cdemo_sk
