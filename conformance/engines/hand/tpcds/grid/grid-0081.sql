SELECT ss_store_sk, SUM(ss_ext_sales_price) AS v
FROM store_sales
WHERE ss_ext_list_price = 128.6 OR ss_ticket_number >= 242
GROUP BY ss_store_sk
