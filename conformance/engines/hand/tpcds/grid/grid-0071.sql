SELECT d.d_qoy, COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT AS v
FROM store_sales ss JOIN date_dim d ON ss.ss_sold_date_sk = d.d_date_sk_1
WHERE COALESCE(ss.ss_list_price, 0) <> 9.26
GROUP BY d.d_qoy
