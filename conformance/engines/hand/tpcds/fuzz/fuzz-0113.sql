-- the ship mode does not filter the item table: its classes for every ship mode, all tied
WITH v AS (SELECT NULLIF(COUNT(DISTINCT i_class) + MAX(CASE WHEN i_class IS NULL THEN 1 ELSE 0 END), 0) AS n FROM item)
SELECT DISTINCT sm.sm_type, v.n
FROM ship_mode sm CROSS JOIN v
WHERE v.n IS NOT NULL
QUALIFY RANK() OVER (ORDER BY v.n DESC) <= 4
