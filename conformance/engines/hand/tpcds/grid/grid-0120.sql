-- DISTINCTCOUNT counts a missing customer as one more value
SELECT i_color, ss_cdemo_sk, NULLIF(COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT, 0)
FROM store_sales JOIN item ON i_item_sk = ss_item_sk
GROUP BY i_color, ss_cdemo_sk
