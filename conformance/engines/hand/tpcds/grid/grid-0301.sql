SELECT o.ca_city, SUM(f.ss_net_profit) AS v
FROM store_sales f
LEFT JOIN customer_address o ON f.ss_addr_sk = o.ca_address_sk
WHERE f.cache_buster IS NOT NULL
GROUP BY o.ca_city
