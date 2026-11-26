-- per year: the year's store revenue (YTD of its last date); MIN(ss_quantity) without a context transition is
-- the least of every sale, plus the year's distinct customers (a missing customer counts as one more). The
-- blank year (store sales with no date, when the model has that blank row) has no year to date.
WITH s AS (
  SELECT d.d_year, SUM(ss.ss_ext_sales_price) AS rev,
    NULLIF(COUNT(DISTINCT ss.ss_customer_sk) + (COUNT(*) > COUNT(ss.ss_customer_sk))::INT, 0) AS customers
  FROM store_sales ss LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
), k AS (
  SELECT MIN(ss_quantity) AS minq FROM store_sales
)
SELECT y.d_year, CASE WHEN y.d_year IS NOT NULL THEN ABS(s.rev) END AS m0,
  CASE WHEN k.minq IS NOT NULL OR s.customers IS NOT NULL THEN COALESCE(k.minq * 2, 0) + COALESCE(s.customers, 0) END AS m1
FROM (SELECT d_year FROM date_dim
      UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_sold_date_sk IS NULL OR ss_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
        OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_sold_date_sk IS NULL OR cs_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))) y
CROSS JOIN k
LEFT JOIN s ON s.d_year IS NOT DISTINCT FROM y.d_year
