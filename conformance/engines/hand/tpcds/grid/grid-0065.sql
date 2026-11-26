SELECT ss_cdemo_sk, (COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT) * 2 AS a, COALESCE(COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT, 0) + 1 AS b, COALESCE(COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT, 0) AS c
FROM store_sales
GROUP BY ss_cdemo_sk
