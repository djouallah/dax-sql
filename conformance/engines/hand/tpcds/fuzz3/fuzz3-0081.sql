-- ADDCOLUMNS' row context filters nothing: the ship mode types joined by commas, the same length for every state
SELECT DISTINCT ca_state, (SELECT LENGTH(string_agg(sm_type, ',')) FROM (SELECT DISTINCT sm_type FROM ship_mode)) AS m0
FROM customer_address
