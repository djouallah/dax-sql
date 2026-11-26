SELECT COUNT(DISTINCT f.ss_customer_sk) + (COUNT(*) > COUNT(f.ss_customer_sk))::INT AS v
FROM store_sales f JOIN promotion o ON o.p_promo_sk = f.ss_promo_sk
