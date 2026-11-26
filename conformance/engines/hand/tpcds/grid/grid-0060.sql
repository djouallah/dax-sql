SELECT ss_cdemo_sk, COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT AS v
FROM store_sales
GROUP BY ss_cdemo_sk
HAVING SUM(ss_ext_sales_price) IS NOT NULL
