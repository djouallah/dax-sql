SELECT o.p_cost, COUNT(DISTINCT f.ss_customer_sk) + (COUNT(*) > COUNT(f.ss_customer_sk))::INT AS v
FROM store_sales f LEFT JOIN promotion o ON o.p_promo_sk = f.ss_promo_sk
WHERE f.ss_item_sk IS NOT NULL
GROUP BY o.p_cost
