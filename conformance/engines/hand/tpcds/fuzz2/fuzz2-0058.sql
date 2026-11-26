-- m0 is a measure (its row's education status filters); MIN is not, so it is the overall minimum.
-- TOTALYTD with no date filter: the last year of the date table, up to its last date.
WITH y AS (SELECT MAX(d_date) AS mx FROM date_dim),
ytd AS (
  SELECT cd.cd_education_status AS e, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk, y
  WHERE d.d_date BETWEEN date_trunc('year', y.mx) AND y.mx
  GROUP BY 1),
mn AS (SELECT MIN(ss_ext_sales_price) AS m FROM store_sales)
SELECT e.cd_education_status, ytd.rev, mn.m
FROM (SELECT DISTINCT cd_education_status FROM customer_demographics) e
LEFT JOIN ytd ON ytd.e IS NOT DISTINCT FROM e.cd_education_status CROSS JOIN mn
