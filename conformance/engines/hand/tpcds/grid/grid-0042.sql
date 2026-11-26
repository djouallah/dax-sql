SELECT ss_cdemo_sk, SUM(ss_ext_sales_price) AS v
FROM store_sales
WHERE ss_ticket_number IN (215, 132)
GROUP BY ss_cdemo_sk
