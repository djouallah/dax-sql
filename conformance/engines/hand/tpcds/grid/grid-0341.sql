SELECT o.ca_county, (COUNT(DISTINCT f.ss_customer_sk) + MAX(CASE WHEN f.ss_customer_sk IS NULL THEN 1 ELSE 0 END)) AS v
FROM store_sales f
LEFT JOIN customer_address o ON f.ss_addr_sk = o.ca_address_sk
WHERE COALESCE(f.ss_ext_sales_price, 0) <> 381.96
GROUP BY o.ca_county
