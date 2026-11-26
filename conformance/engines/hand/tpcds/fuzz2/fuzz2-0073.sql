-- m0: TOTALYTD with no date filter, the date table's last year
WITH y AS (SELECT MAX(d_date) AS mx FROM date_dim)
SELECT
  (SELECT MIN(cs.cs_ext_sales_price) FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk, y
   WHERE d.d_date BETWEEN date_trunc('year', y.mx) AND y.mx) AS m0,
  (SELECT MAX(ss_quantity) FROM store_sales) AS m1,
  CASE WHEN (SELECT COALESCE(MAX(cs_quantity), 0) FROM catalog_sales) > 100 THEN (SELECT MAX(ss_ext_sales_price) FROM store_sales)::DOUBLE
    ELSE (SELECT NULLIF(COUNT(DISTINCT ca_state) + (COUNT(*) > COUNT(ca_state))::INT, 0) FROM customer_address) END AS m2
