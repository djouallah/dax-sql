SELECT NULLIF(COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT, 0) AS v
FROM store_sales
