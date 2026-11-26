SELECT cs_bill_cdemo_sk, SUM(cs_quantity) AS v
FROM catalog_sales
GROUP BY cs_bill_cdemo_sk
ORDER BY v DESC NULLS LAST, cs_bill_cdemo_sk NULLS FIRST
