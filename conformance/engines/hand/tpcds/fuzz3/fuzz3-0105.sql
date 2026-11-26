-- neither table filters the items: every color counted (a blank color one more value), for each pair
SELECT e.cd_education_status, m.sm_type, n.n
FROM (SELECT DISTINCT cd_education_status FROM customer_demographics) e
CROSS JOIN (SELECT DISTINCT sm_type FROM ship_mode) m
CROSS JOIN (SELECT COUNT(DISTINCT i_color) + MAX((i_color IS NULL)::INT) AS n FROM item) n
