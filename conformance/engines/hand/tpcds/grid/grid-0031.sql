SELECT ss_cdemo_sk, COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT AS v
FROM store_sales
WHERE ss_store_sk <> 1
GROUP BY ss_cdemo_sk
