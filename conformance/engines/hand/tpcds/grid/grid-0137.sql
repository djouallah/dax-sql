-- DISTINCTCOUNT counts a missing customer as one more value
WITH g AS (
  SELECT ss_store_sk, NULLIF(COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT, 0) AS m
  FROM store_sales GROUP BY ss_store_sk)
-- blank * 2 is blank, blank + 1 is 1
SELECT ss_store_sk, m * 2, COALESCE(m, 0) + 1, COALESCE(m, 0) FROM g
