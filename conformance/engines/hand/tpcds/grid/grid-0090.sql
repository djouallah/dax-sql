SELECT ss_store_sk, CAST(COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT AS DOUBLE) / NULLIF(SUM(ss_net_profit), 0) AS r
FROM store_sales
GROUP BY ss_store_sk
