-- ship_mode does not filter store_sales: every type gets the total (the blank type too: a catalog sale
-- with no or an unknown ship mode)
WITH t AS (SELECT SUM(ss_quantity) AS q FROM store_sales),
sm AS (
  SELECT DISTINCT sm_type FROM ship_mode
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM catalog_sales WHERE cs_ship_mode_sk IS NULL OR cs_ship_mode_sk NOT IN (SELECT sm_ship_mode_sk FROM ship_mode))
)
SELECT sm.sm_type, t.q FROM sm, t WHERE t.q IS NOT NULL
QUALIFY RANK() OVER (ORDER BY t.q) <= 4
