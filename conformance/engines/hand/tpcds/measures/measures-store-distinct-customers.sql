-- DISTINCTCOUNT counts a missing customer as one more value
SELECT ca.ca_state, COUNT(DISTINCT ss.ss_customer_sk) + (COUNT(*) > COUNT(ss.ss_customer_sk))::INT AS customers
FROM store_sales ss LEFT JOIN customer_address ca ON ca.ca_address_sk = ss.ss_addr_sk
GROUP BY ca.ca_state
