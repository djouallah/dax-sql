SELECT cd.cd_education_status, SUM(cs.cs_ext_sales_price) AS shipped
FROM catalog_sales cs
JOIN customer_address ca ON ca.ca_address_sk = cs.cs_ship_addr_sk
LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_ship_cdemo_sk
WHERE ca.ca_state = 'CA'
GROUP BY cd.cd_education_status
HAVING shipped IS NOT NULL
