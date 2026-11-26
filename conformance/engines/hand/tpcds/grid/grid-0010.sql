SELECT ss_quantity, COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT AS v
FROM store_sales
GROUP BY ss_quantity
HAVING SUM(ss_ext_sales_price) IS NOT NULL
