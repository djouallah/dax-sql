-- no filter: store revenue YoY against every date a year back, twice, plus catalog profit times the least
-- store profit (two fixed decimals multiplied: a number)
WITH shift AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), s AS (
  SELECT SUM(ss.ss_ext_sales_price) AS rev, SUM(ss.ss_ext_sales_price) FILTER (WHERE d.d_date IN (SELECT ly FROM shift)) AS ly,
    MIN(ss.ss_net_profit) AS minp
  FROM store_sales ss LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
), t AS (
  SELECT (COALESCE(rev, 0) - ly) / NULLIF(ly, 0) AS yoy, (SELECT SUM(cs_net_profit) FROM catalog_sales)::DOUBLE * minp::DOUBLE AS x FROM s
)
SELECT CASE WHEN yoy IS NOT NULL OR x IS NOT NULL THEN COALESCE(yoy * 2, 0) + COALESCE(x, 0) END AS m0 FROM t
