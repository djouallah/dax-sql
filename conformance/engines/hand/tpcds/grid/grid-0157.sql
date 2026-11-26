SELECT cs_bill_cdemo_sk, SUM(cs_ext_sales_price)
FROM catalog_sales
GROUP BY cs_bill_cdemo_sk
ORDER BY cs_bill_cdemo_sk NULLS FIRST
