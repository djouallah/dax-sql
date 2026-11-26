SELECT ss_quantity, COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT AS v
FROM store_sales
GROUP BY ss_quantity
ORDER BY ss_quantity NULLS FIRST
