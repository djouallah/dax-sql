-- ship_mode does not filter store_sales: every type gets the total
WITH t AS (SELECT SUM(ss_quantity) AS q FROM store_sales)
SELECT DISTINCT sm.sm_type, t.q FROM ship_mode sm, t WHERE t.q IS NOT NULL
QUALIFY RANK() OVER (ORDER BY t.q) <= 4
