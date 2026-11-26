-- DISTINCTCOUNT counts a missing customer as one more value
WITH g AS (
  SELECT ss_promo_sk, NULLIF(COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT, 0) AS n, SUM(ss_ext_sales_price) AS d
  FROM store_sales GROUP BY ss_promo_sk)
SELECT ss_promo_sk, n::DOUBLE / CASE WHEN d = 0 THEN NULL ELSE d END FROM g
