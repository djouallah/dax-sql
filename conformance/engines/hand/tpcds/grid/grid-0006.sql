SELECT ss_quantity, SUM(ss_ext_sales_price) AS v
FROM store_sales
WHERE ss_cdemo_sk BETWEEN 1 AND 12 AND COALESCE(ss_ticket_number, 0) < 344
GROUP BY ss_quantity
