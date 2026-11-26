SELECT o.p_cost, SUM(f.ss_net_profit) AS v
FROM store_sales f LEFT JOIN promotion o ON o.p_promo_sk = f.ss_promo_sk
WHERE COALESCE(o.p_cost, 0) < 205.77
GROUP BY o.p_cost
