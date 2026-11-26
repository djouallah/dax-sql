-- the store and item tables are filtered by neither the dates nor the address: the larger of their
-- row counts for every month, all tied
WITH v AS (SELECT GREATEST((SELECT COUNT(*) FROM store), (SELECT COUNT(*) FROM item)) AS m0)
SELECT DISTINCT d.d_moy, v.m0
FROM date_dim d CROSS JOIN v
WHERE v.m0 > 0
QUALIFY RANK() OVER (ORDER BY v.m0) <= 1
