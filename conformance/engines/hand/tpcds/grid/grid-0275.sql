SELECT cs_bill_cdemo_sk, SUM(cs_ext_sales_price) AS v
FROM catalog_sales
WHERE COALESCE(cs_list_price, 0) >= 86.52
GROUP BY cs_bill_cdemo_sk
