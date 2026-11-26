-- per customer state (a sale with no address: a blank state): distinct store customers; the 4 highest, ties kept
SELECT ca.ca_state, COUNT(DISTINCT ss.ss_customer_sk) + MAX(CASE WHEN ss.ss_customer_sk IS NULL THEN 1 ELSE 0 END) AS m0
FROM store_sales ss LEFT JOIN customer_address ca ON ca.ca_address_sk = ss.ss_addr_sk
GROUP BY ca.ca_state
QUALIFY RANK() OVER (ORDER BY m0 DESC) <= 4
