SELECT o.ca_county, SUM(f.ss_ext_sales_price) AS v
FROM store_sales f
JOIN customer_address o ON f.ss_addr_sk = o.ca_address_sk
WHERE f.ss_promo_sk = 1
GROUP BY o.ca_county
