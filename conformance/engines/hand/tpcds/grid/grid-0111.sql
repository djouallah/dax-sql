-- DISTINCTCOUNT counts a missing customer as one more value
SELECT ss_promo_sk, NULLIF(COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT, 0)
FROM store_sales
GROUP BY ss_promo_sk
