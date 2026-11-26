SELECT ss_store_sk, COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT AS v
FROM store_sales
WHERE ss_sold_date_sk IN (2461201, 2461394)
GROUP BY ss_store_sk
