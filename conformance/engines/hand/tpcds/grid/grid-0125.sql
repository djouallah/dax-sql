-- DISTINCTCOUNT counts a missing customer as one more value
SELECT ss_store_sk, NULLIF(COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT, 0), SUM(ss_net_profit)
FROM store_sales
GROUP BY ss_store_sk
