SELECT ss_quantity, CAST(COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT AS DOUBLE) / NULLIF(SUM(ss_ext_sales_price), 0) AS r
FROM store_sales
GROUP BY ss_quantity
