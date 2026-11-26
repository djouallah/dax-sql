-- DISTINCTCOUNT counts a missing customer as one more value
SELECT s_store_name, NULLIF(COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT, 0)
FROM store_sales JOIN store ON s_store_sk = ss_store_sk
GROUP BY s_store_name
