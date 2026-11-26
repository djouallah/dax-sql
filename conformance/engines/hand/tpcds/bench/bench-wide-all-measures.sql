WITH s AS (
  SELECT d.d_year, SUM(ss.ss_ext_sales_price) AS a, SUM(ss.ss_net_profit) AS b,
         COUNT(DISTINCT ss.ss_customer_sk) + (COUNT(*) > COUNT(ss.ss_customer_sk))::INT AS c
  FROM store_sales ss LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY d.d_year),
c AS (
  SELECT d.d_year, SUM(cs.cs_ext_sales_price) AS d, SUM(cs.cs_quantity) AS e
  FROM catalog_sales cs LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY d.d_year)
SELECT COALESCE(s.d_year, c.d_year), s.a, s.b, s.c, c.d, c.e
FROM s FULL JOIN c ON c.d_year IS NOT DISTINCT FROM s.d_year
WHERE s.c IS NOT NULL OR c.d IS NOT NULL OR c.e IS NOT NULL
