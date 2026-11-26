-- a ship mode filters no item: every ship mode gets the count of item colours, so all tie for the top two
-- (and the blank type of ship_mode's blank row, there when a catalog sale has no or an unknown ship mode)
SELECT t.sm_type, (SELECT COUNT(DISTINCT i_color) + MAX(CASE WHEN i_color IS NULL THEN 1 ELSE 0 END) FROM item) AS m0
FROM (SELECT DISTINCT sm_type FROM ship_mode
      UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM catalog_sales WHERE cs_ship_mode_sk IS NULL OR cs_ship_mode_sk NOT IN (SELECT sm_ship_mode_sk FROM ship_mode))) t
WHERE m0 IS NOT NULL
QUALIFY RANK() OVER (ORDER BY m0 DESC) <= 2
