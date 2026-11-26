SELECT o.ca_city, f.ss_promo_sk, COUNT(DISTINCT f.ss_customer_sk) + (COUNT(*) > COUNT(f.ss_customer_sk))::INT AS v
FROM store_sales f LEFT JOIN customer_address o ON o.ca_address_sk = f.ss_addr_sk
GROUP BY o.ca_city, f.ss_promo_sk
