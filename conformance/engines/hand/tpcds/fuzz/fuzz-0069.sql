-- the ship mode does not filter store_sales: every ship mode (the blank one too, when some catalog sale has no
-- ship mode) has the average over the last year
WITH a AS (
  SELECT ROUND(ROUND(ROUND(AVG(ss.ss_ext_sales_price), 4), 2), 1) AS v
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  WHERE d.d_year = (SELECT MAX(d_year) FROM date_dim)
)
SELECT sm.sm_type, a.v
FROM (SELECT sm_type FROM ship_mode UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM catalog_sales WHERE cs_ship_mode_sk IS NULL OR cs_ship_mode_sk NOT IN (SELECT sm_ship_mode_sk FROM ship_mode))) sm
CROSS JOIN a WHERE a.v IS NOT NULL
