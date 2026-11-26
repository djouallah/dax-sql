SELECT o.p_cost, COUNT(DISTINCT f.ss_customer_sk) + (COUNT(*) > COUNT(f.ss_customer_sk))::INT AS v
FROM store_sales f LEFT JOIN promotion o ON o.p_promo_sk = f.ss_promo_sk
WHERE o.p_promo_sk BETWEEN 1 AND 7
GROUP BY o.p_cost
