SELECT cs_bill_cdemo_sk, SUM(cs_quantity) AS v
FROM catalog_sales
WHERE NOT (COALESCE(cs_ext_sales_price, 0) = 2248.31) AND COALESCE(cs_ship_cdemo_sk, 0) = 3
GROUP BY cs_bill_cdemo_sk
