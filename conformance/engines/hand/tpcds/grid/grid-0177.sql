-- a blank compares as 0
SELECT cs_bill_cdemo_sk, SUM(cs_ext_sales_price)
FROM catalog_sales
WHERE cs_net_profit = -119.18 OR COALESCE(cache_buster, 0) < 1
GROUP BY cs_bill_cdemo_sk
