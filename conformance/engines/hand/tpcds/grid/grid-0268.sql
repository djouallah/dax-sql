SELECT cs_bill_cdemo_sk, SUM(cs_quantity) AS v
FROM catalog_sales
GROUP BY cs_bill_cdemo_sk
HAVING SUM(cs_ext_sales_price) IS NOT NULL
