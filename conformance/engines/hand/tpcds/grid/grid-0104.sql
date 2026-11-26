-- a blank compares as 0
-- DISTINCTCOUNT counts a missing customer as one more value
SELECT ss_promo_sk, NULLIF(COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT, 0)
FROM store_sales
WHERE COALESCE(ss_sold_date_sk, 0) <> 2461290 AND COALESCE(ss_addr_sk, 0) < 2
GROUP BY ss_promo_sk
