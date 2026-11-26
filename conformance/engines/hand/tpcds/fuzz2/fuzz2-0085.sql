-- The dates do not filter customer_demographics: each education status counts itself, so every ship type
-- has the number of education statuses (all tie; the blank status, of the table's blank row, counts 0). A catalog
-- sale with no (or an unknown) ship mode makes ship_mode's blank row: a blank ship type, tied too.
WITH n AS (SELECT NULLIF(COUNT(DISTINCT cd_education_status) + (COUNT(*) > COUNT(cd_education_status))::INT, 0) AS n FROM customer_demographics),
t AS (
  SELECT DISTINCT sm_type FROM ship_mode
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM catalog_sales WHERE cs_ship_mode_sk IS NULL OR cs_ship_mode_sk NOT IN (SELECT sm_ship_mode_sk FROM ship_mode)))
SELECT t.sm_type, n.n AS m0 FROM t, n WHERE n.n IS NOT NULL
QUALIFY RANK() OVER (ORDER BY n.n) <= 2
