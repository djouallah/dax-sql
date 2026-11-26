SELECT o.p_cost, SUM(f.ss_net_profit) AS v
FROM store_sales f LEFT JOIN promotion o ON o.p_promo_sk = f.ss_promo_sk
GROUP BY o.p_cost
