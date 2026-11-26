-- the dates from 2026-06-07 to 2025-03-16 (none); HASONEVALUE(p_promo_name) with no promotion filter
SELECT s.s_city, ROUND(SUM(ss.ss_net_profit) / COUNT(ss.ss_net_profit), 4) AS m0
FROM store_sales ss
JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_date BETWEEN DATE '2026-06-07' AND DATE '2025-03-16'
LEFT JOIN store s ON s.s_store_sk = ss.ss_store_sk
WHERE (SELECT COUNT(DISTINCT p_promo_name) FROM promotion) = 1
GROUP BY s.s_city
HAVING m0 IS NOT NULL
