SELECT o.ca_county, SUM(f.ss_net_profit) AS v
FROM store_sales f
LEFT JOIN customer_address o ON f.ss_addr_sk = o.ca_address_sk
WHERE COALESCE(o.ca_county, '') <> 'Barrow County'
GROUP BY o.ca_county
