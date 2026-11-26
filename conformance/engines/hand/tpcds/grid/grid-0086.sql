SELECT ss_store_sk, COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT AS v
FROM store_sales
GROUP BY ss_store_sk
ORDER BY v DESC NULLS LAST, ss_store_sk NULLS FIRST
