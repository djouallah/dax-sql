-- per year: the year's store revenue (YTD of its last date); MIN(ss_quantity) without a context transition is
-- the least of every sale, plus the year's distinct customers (a missing customer counts as one more)
WITH s AS (
  SELECT d.d_year, SUM(ss.ss_ext_sales_price) AS rev,
    NULLIF(COUNT(DISTINCT ss.ss_customer_sk) + (COUNT(*) > COUNT(ss.ss_customer_sk))::INT, 0) AS customers
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
), k AS (
  SELECT MIN(ss_quantity) AS minq FROM store_sales
)
SELECT y.d_year, ABS(s.rev) AS m0,
  CASE WHEN k.minq IS NOT NULL OR s.customers IS NOT NULL THEN COALESCE(k.minq * 2, 0) + COALESCE(s.customers, 0) END AS m1
FROM (SELECT DISTINCT d_year FROM date_dim) y CROSS JOIN k
LEFT JOIN s ON s.d_year = y.d_year
