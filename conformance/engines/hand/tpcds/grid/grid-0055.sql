SELECT ss_cdemo_sk, COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT AS v
FROM store_sales
WHERE COALESCE(ss_list_price, 0) <> 74.02
GROUP BY ss_cdemo_sk
