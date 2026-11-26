-- no filter: HASONEVALUE(d_year) is false (blank); YTD = the last date's year; YoY against every date a year back;
-- a blank compares as 0 in a two-argument MAX
WITH shift AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), s AS (
  SELECT SUM(ss.ss_ext_sales_price) AS rev,
    SUM(ss.ss_ext_sales_price) FILTER (WHERE d.d_date IN (SELECT ly FROM shift)) AS ly,
    SUM(ss.ss_ext_sales_price) FILTER (WHERE d.d_date BETWEEN date_trunc('year', (SELECT MAX(d_date) FROM date_dim))::DATE
                                                     AND (SELECT MAX(d_date) FROM date_dim)) AS ytd
  FROM store_sales ss LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
), b AS (
  SELECT CASE WHEN (SELECT COUNT(DISTINCT d_year) FROM date_dim) = 1 THEN (SELECT SUM(cs_ext_sales_price) FROM catalog_sales) END AS x,
    (COALESCE(rev, 0) - ly) / NULLIF(ly, 0) AS yoy, rev, ytd
  FROM s
), c AS (
  SELECT x, COALESCE(ytd, 0) * 2
    + COALESCE(CASE WHEN COALESCE(yoy, 0) > COALESCE(rev, 0) THEN yoy WHEN COALESCE(rev, 0) > COALESCE(yoy, 0) THEN rev ELSE COALESCE(yoy, rev) END, 0) AS y
  FROM b
)
SELECT CASE WHEN COALESCE(x, 0) > COALESCE(y, 0) THEN x WHEN COALESCE(y, 0) > COALESCE(x, 0) THEN y ELSE COALESCE(x, y) END AS m0 FROM c
