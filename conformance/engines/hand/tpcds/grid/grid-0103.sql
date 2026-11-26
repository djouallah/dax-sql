SELECT ss_promo_sk, SUM(ss_ext_sales_price)
FROM store_sales
WHERE ss_customer_sk >= 40
GROUP BY ss_promo_sk
