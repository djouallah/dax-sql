-- DISTINCTCOUNT counts a missing customer as one more value
-- the grand total is the row with a blank ss_quantity
SELECT ss_quantity, NULLIF(COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT, 0)
FROM store_sales
GROUP BY ROLLUP (ss_quantity)
ORDER BY ss_quantity IS NULL, ss_quantity, GROUPING(ss_quantity)
