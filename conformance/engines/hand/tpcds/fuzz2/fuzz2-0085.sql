-- The dates do not filter customer_demographics: each education status counts itself, so every ship type
-- has the number of education statuses (all tie)
WITH n AS (SELECT NULLIF(COUNT(DISTINCT cd_education_status) + (COUNT(*) > COUNT(cd_education_status))::INT, 0) AS n FROM customer_demographics)
SELECT DISTINCT sm.sm_type, n.n AS m0 FROM ship_mode sm, n WHERE n.n IS NOT NULL
QUALIFY RANK() OVER (ORDER BY n.n) <= 2
