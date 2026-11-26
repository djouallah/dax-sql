SELECT COUNT(DISTINCT ss_customer_sk) + MAX(CASE WHEN ss_customer_sk IS NULL THEN 1 ELSE 0 END) AS v
FROM store_sales
