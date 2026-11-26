-- the store filter does not reach catalog_sales
SELECT ca.ca_state, cd.cd_education_status, MAX(cs.cs_quantity)
FROM catalog_sales cs
LEFT JOIN customer_address ca ON ca.ca_address_sk = cs.cs_bill_addr_sk
LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
GROUP BY 1, 2
HAVING MAX(cs.cs_quantity) IS NOT NULL
