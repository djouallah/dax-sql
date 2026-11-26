-- a blank compares as 0
-- DISTINCTCOUNT counts a missing customer as one more value
SELECT i_color, NULLIF(COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT, 0)
FROM store_sales JOIN item ON i_item_sk = ss_item_sk
WHERE COALESCE(i_current_price, 0) < 41.89
GROUP BY i_color
