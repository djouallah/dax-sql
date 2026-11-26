-- the ship mode does not filter the item table: its classes for every ship mode, all tied (the blank
-- type too: a catalog sale with no or an unknown ship mode)
WITH v AS (SELECT NULLIF(COUNT(DISTINCT i_class) + MAX(CASE WHEN i_class IS NULL THEN 1 ELSE 0 END), 0) AS n FROM item),
t AS (
  SELECT DISTINCT sm_type FROM ship_mode
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM catalog_sales WHERE cs_ship_mode_sk IS NULL OR cs_ship_mode_sk NOT IN (SELECT sm_ship_mode_sk FROM ship_mode))
)
SELECT t.sm_type, v.n
FROM t CROSS JOIN v
WHERE v.n IS NOT NULL
QUALIFY RANK() OVER (ORDER BY v.n DESC) <= 4
