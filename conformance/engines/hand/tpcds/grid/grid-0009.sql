SELECT ss_quantity, SUM(ss_ext_sales_price) AS v
FROM store_sales
GROUP BY ss_quantity
