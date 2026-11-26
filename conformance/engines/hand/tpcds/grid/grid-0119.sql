-- DISTINCTCOUNT counts a missing customer as one more value
SELECT i_color, NULLIF(COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT, 0)
FROM store_sales JOIN item ON i_item_sk = ss_item_sk
WHERE ss_ext_sales_price = 243.3
GROUP BY i_color
