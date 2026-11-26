SELECT (SELECT NULLIF(COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT, 0) FROM store_sales) AS m0,
  (SELECT NULLIF(COUNT(*), 0) FROM store) AS m1
