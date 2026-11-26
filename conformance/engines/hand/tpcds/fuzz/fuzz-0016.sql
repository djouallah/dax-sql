-- store revenue against every date a year back (no filter)
WITH shift AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), s AS (
  SELECT SUM(ss.ss_ext_sales_price) AS rev, SUM(ss.ss_ext_sales_price) FILTER (WHERE d.d_date IN (SELECT ly FROM shift)) AS ly
  FROM store_sales ss LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
), t AS (
  SELECT CASE WHEN (SELECT COUNT(cs_net_profit) FROM catalog_sales) = 0 THEN 0 ELSE (COALESCE(rev, 0) - ly) / NULLIF(ly, 0) END AS m0,
    (SELECT NULLIF(COUNT(*), 0) FROM stg_tpcds_archive_log) AS m1
  FROM s
)
SELECT * FROM t WHERE m0 IS NOT NULL OR m1 IS NOT NULL
