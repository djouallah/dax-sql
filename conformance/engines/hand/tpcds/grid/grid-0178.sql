SELECT SUM(cs_ext_sales_price)
FROM catalog_sales
WHERE cs_promo_sk IS NOT NULL
