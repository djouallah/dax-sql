SELECT cs_ship_addr_sk, SUM(cs_ext_sales_price) AS v
FROM catalog_sales
WHERE cs_promo_sk = 7 AND COALESCE(cs_ship_cdemo_sk, 0) >= 4
GROUP BY cs_ship_addr_sk
