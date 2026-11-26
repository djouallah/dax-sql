-- HASONEVALUE(d_year) with no filter on date_dim: true only when the date table holds a single year
SELECT p.p_promo_name, SUM(cs.cs_net_profit) AS m0
FROM catalog_sales cs LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
WHERE (SELECT COUNT(DISTINCT d_year) FROM date_dim) = 1
GROUP BY p.p_promo_name
HAVING SUM(cs.cs_net_profit) IS NOT NULL
QUALIFY RANK() OVER (ORDER BY SUM(cs.cs_net_profit) DESC) <= 3
