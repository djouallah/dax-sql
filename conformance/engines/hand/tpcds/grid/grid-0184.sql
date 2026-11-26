-- the grand total is the row with a blank cs_promo_sk
SELECT cs_promo_sk, SUM(cs_quantity)
FROM catalog_sales
GROUP BY ROLLUP (cs_promo_sk)
ORDER BY cs_promo_sk IS NULL, cs_promo_sk, GROUPING(cs_promo_sk)
