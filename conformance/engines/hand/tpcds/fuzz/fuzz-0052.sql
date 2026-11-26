-- stores of TN: their cities by every customer state (m0 is never blank); no filter reaches item from them
SELECT c.s_city, a.ca_state, (SELECT NULLIF(COUNT(*), 0) FROM item) AS m0
FROM (SELECT DISTINCT s_city FROM store WHERE s_state = 'TN') c CROSS JOIN (SELECT DISTINCT ca_state FROM customer_address) a
WHERE m0 IS NOT NULL
