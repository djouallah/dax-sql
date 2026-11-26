SELECT ss_quantity, ss_addr_sk, SUM(ss_ext_sales_price) AS v
FROM store_sales
GROUP BY ss_quantity, ss_addr_sk
