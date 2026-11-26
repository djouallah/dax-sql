-- a blank compares as 0
SELECT ss_store_sk, SUM(ss_ext_sales_price)
FROM store_sales
WHERE COALESCE(ss_ticket_number, 0) < 31 OR ss_list_price = 35.08
GROUP BY ss_store_sk
