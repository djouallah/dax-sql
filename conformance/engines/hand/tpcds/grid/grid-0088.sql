SELECT ss_store_sk, COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT AS v
FROM store_sales
GROUP BY ROLLUP (ss_store_sk)
ORDER BY ss_store_sk IS NULL, ss_store_sk, GROUPING(ss_store_sk)
