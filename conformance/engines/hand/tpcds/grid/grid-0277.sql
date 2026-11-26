SELECT o.ca_city, SUM(f.ss_ext_sales_price) AS v
FROM store_sales f LEFT JOIN customer_address o ON o.ca_address_sk = f.ss_addr_sk
GROUP BY o.ca_city
