SELECT ss_quantity, COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT AS v
FROM store_sales
WHERE cache_buster IS NOT NULL
GROUP BY ss_quantity
