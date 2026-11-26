-- REMOVEFILTERS(store_sales) clears its expanded table, dates too: every year shows all distinct customers (a
-- missing one counting once); and last year's store revenue (whole years: the year before), rounded. The blank
-- year (sales with no date) has no year before
WITH y AS (
  SELECT d.d_year AS y, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
)
SELECT g.d_year,
  (SELECT COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT FROM store_sales) AS m0,
  ROUND(l.rev, 0) AS m1
FROM (SELECT d_year FROM date_dim
      UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales ANTI JOIN date_dim ON d_date_sk_1 = ss_sold_date_sk)
        OR EXISTS (SELECT 1 FROM catalog_sales ANTI JOIN date_dim ON d_date_sk_1 = cs_sold_date_sk)) g LEFT JOIN y l ON l.y = g.d_year - 1
