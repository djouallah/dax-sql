SELECT cs_bill_cdemo_sk, SUM(cs_ext_sales_price) AS v
FROM catalog_sales
GROUP BY cs_bill_cdemo_sk
ORDER BY v DESC NULLS LAST, cs_bill_cdemo_sk NULLS FIRST
