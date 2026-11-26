SELECT cs_bill_cdemo_sk, SUM(cs_ext_sales_price) * 2 AS a, COALESCE(SUM(cs_ext_sales_price), 0) + 1 AS b, COALESCE(SUM(cs_ext_sales_price), 0) AS c
FROM catalog_sales
GROUP BY cs_bill_cdemo_sk
