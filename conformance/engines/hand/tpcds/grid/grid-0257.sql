SELECT o.p_promo_name, SUM(f.ss_ext_sales_price) AS v
FROM store_sales f JOIN promotion o ON o.p_promo_sk = f.ss_promo_sk
WHERE NOT (COALESCE(f.ss_sold_date_sk, 0) = 2460928)
GROUP BY o.p_promo_name
