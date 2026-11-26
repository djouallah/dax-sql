SELECT o.p_promo_name, SUM(f.ss_ext_sales_price) AS v
FROM store_sales f JOIN promotion o ON o.p_promo_sk = f.ss_promo_sk
WHERE o.p_promo_sk IN (6, 1)
GROUP BY o.p_promo_name
