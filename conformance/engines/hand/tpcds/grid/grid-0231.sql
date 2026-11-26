SELECT cs_bill_cdemo_sk, SUM(cs_ext_sales_price) AS v
FROM catalog_sales
WHERE cs_bill_addr_sk IN (4, 5)
GROUP BY cs_bill_cdemo_sk
