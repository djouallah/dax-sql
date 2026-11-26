-- DISTINCTCOUNT counts a missing customer as one more value
WITH g AS (
  SELECT ss_store_sk, SUM(ss_net_profit) AS n, NULLIF(COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT, 0) AS d
  FROM store_sales GROUP BY ss_store_sk)
SELECT ss_store_sk, n::DOUBLE / CASE WHEN d = 0 THEN NULL ELSE d END FROM g
