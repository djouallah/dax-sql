SELECT ss_promo_sk, SUM(ss_ext_sales_price)
FROM store_sales
GROUP BY ss_promo_sk
