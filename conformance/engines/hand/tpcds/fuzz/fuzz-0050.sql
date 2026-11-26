-- every month by every store city by every ship mode type (m0 is never blank), each with its blank value when
-- the model has that blank row; no filter reaches item from them
SELECT m.d_moy, c.s_city, t.sm_type,
  (SELECT COALESCE(ABS(NULLIF(COUNT(DISTINCT i_current_price) + (COUNT(*) > COUNT(i_current_price))::INT, 0)), 0) FROM item) AS m0
FROM (SELECT d_moy FROM date_dim
      UNION SELECT NULL
      WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_sold_date_sk IS NULL OR ss_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
         OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_sold_date_sk IS NULL OR cs_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))) m
CROSS JOIN (SELECT s_city FROM store UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store))) c
CROSS JOIN (SELECT sm_type FROM ship_mode UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM catalog_sales WHERE cs_ship_mode_sk IS NULL OR cs_ship_mode_sk NOT IN (SELECT sm_ship_mode_sk FROM ship_mode))) t
