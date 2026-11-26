SELECT ss_quantity, SUM(ss_ext_sales_price) AS v
FROM store_sales
WHERE ss_ticket_number = 300
GROUP BY ss_quantity
