-- every month by every store city by every ship mode type (m0 is never blank); no filter reaches item from them
SELECT m.d_moy, c.s_city, t.sm_type,
  (SELECT COALESCE(ABS(NULLIF(COUNT(DISTINCT i_current_price) + (COUNT(*) > COUNT(i_current_price))::INT, 0)), 0) FROM item) AS m0
FROM (SELECT DISTINCT d_moy FROM date_dim) m CROSS JOIN (SELECT DISTINCT s_city FROM store) c CROSS JOIN (SELECT DISTINCT sm_type FROM ship_mode) t
