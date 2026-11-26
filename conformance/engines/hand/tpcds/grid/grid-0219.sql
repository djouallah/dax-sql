SELECT cs_bill_cdemo_sk, SUM(cs_ext_sales_price) AS v
FROM catalog_sales
WHERE cs_catalog_page_sk IN (4, 2)
GROUP BY cs_bill_cdemo_sk
