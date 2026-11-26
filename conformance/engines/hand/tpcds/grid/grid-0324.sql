SELECT o.ca_county, f.ss_quantity, SUM(f.ss_net_profit) AS v
FROM store_sales f
LEFT JOIN customer_address o ON f.ss_addr_sk = o.ca_address_sk
GROUP BY o.ca_county, f.ss_quantity
