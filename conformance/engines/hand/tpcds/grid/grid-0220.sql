SELECT cs_bill_cdemo_sk, SUM(cs_quantity) AS v
FROM catalog_sales
WHERE NOT (COALESCE(cache_buster, 0) = 0) AND COALESCE(cs_order_number, 0) >= 95
GROUP BY cs_bill_cdemo_sk
