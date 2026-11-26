SELECT cs_bill_cdemo_sk, SUM(cs_ext_sales_price)
FROM catalog_sales
WHERE cs_net_profit IS NOT NULL AND cache_buster = 2
GROUP BY cs_bill_cdemo_sk
