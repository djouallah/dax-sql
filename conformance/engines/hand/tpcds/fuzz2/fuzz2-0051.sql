-- TOTALYTD with no date filter: the last year of the date table, up to its last date
WITH y AS (SELECT MAX(d_date) AS mx FROM date_dim),
ytd AS (
  SELECT SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk, y
  WHERE d.d_date BETWEEN date_trunc('year', y.mx) AND y.mx),
tot AS (SELECT ROUND(SUM(ss_ext_sales_price), 0) AS rev FROM store_sales)
SELECT COALESCE(ytd.rev::DOUBLE / NULLIF(tot.rev, 0), 0) AS m0 FROM ytd, tot
