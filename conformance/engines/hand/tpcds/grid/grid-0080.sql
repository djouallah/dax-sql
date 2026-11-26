SELECT ss_store_sk, SUM(ss_ext_sales_price) AS v
FROM store_sales
WHERE COALESCE(ss_ticket_number, 0) < 43 AND ss_store_sk IN (6, 2)
GROUP BY ss_store_sk
