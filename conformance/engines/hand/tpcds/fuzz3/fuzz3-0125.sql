-- the store filter reaches no catalog sale; the promotion filter does
SELECT sm.sm_type, SUM(cs.cs_quantity) AS m0
FROM catalog_sales cs
JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk AND p.p_promo_name IN ('barought', 'ese')
LEFT JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk
GROUP BY ALL
HAVING SUM(cs.cs_quantity) IS NOT NULL
