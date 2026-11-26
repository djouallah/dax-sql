-- the FILTER's SUM has no context transition (all colors or none), and neither item nor the
-- address relationship reaches promotion: the promotion names (a blank name counts) per price
SELECT p.i_current_price, (SELECT NULLIF(COUNT(DISTINCT p_promo_name) + MAX(CASE WHEN p_promo_name IS NULL THEN 1 ELSE 0 END), 0) FROM promotion) AS m0
FROM (SELECT DISTINCT i_current_price FROM item) p
