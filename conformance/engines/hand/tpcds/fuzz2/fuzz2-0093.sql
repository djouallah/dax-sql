SELECT ca.ca_state, MIN(ss.ss_quantity) AS m0
FROM store_sales ss LEFT JOIN customer_address ca ON ca.ca_address_sk = ss.ss_addr_sk
GROUP BY 1
HAVING MIN(ss.ss_quantity) IS NOT NULL
