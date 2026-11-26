SELECT SUM(f.ss_ext_sales_price) AS v
FROM store_sales f
JOIN customer_address o ON f.ss_addr_sk = o.ca_address_sk
