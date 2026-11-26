SELECT cs_bill_cdemo_sk, CAST(SUM(cs_net_profit) AS DOUBLE) / NULLIF(SUM(cs_ext_sales_price), 0) AS r
FROM catalog_sales
GROUP BY cs_bill_cdemo_sk
