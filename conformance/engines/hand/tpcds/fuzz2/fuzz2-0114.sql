-- a ship mode filters no item: every ship mode gets the count of item colours, so all tie for the top two
SELECT t.sm_type, (SELECT COUNT(DISTINCT i_color) + MAX(CASE WHEN i_color IS NULL THEN 1 ELSE 0 END) FROM item) AS m0
FROM (SELECT DISTINCT sm_type FROM ship_mode) t
WHERE m0 IS NOT NULL
QUALIFY RANK() OVER (ORDER BY m0 DESC) <= 2
