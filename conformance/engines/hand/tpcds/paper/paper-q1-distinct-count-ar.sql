-- DISTINCTCOUNT counts a missing customer as one more value; no rows is blank
SELECT NULLIF(COUNT(DISTINCT ss.ss_customer_sk) + (COUNT(*) > COUNT(ss.ss_customer_sk))::INT, 0) AS Store_Distinct_Customers
FROM store_sales ss
JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_year = 2025
JOIN customer_address ca ON ca.ca_address_sk = ss.ss_addr_sk AND ca.ca_state = 'AR'
JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk AND cd.cd_education_status = '2 yr Degree'
WHERE ss.cache_buster < 2
