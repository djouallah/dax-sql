-- per class but dresses: store revenue over every date a year back (SAMEPERIODLASTYEAR of all dates, a month's
-- last day also reaching Feb 29); the SWITCH's second test is an empty date range (blank < 100), so it is
-- |store revenue| when the catalog's largest profit passes 10, else the archive's file count
WITH ly AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), s AS (
  SELECT i.i_class AS c, SUM(ss.ss_ext_sales_price) AS rev,
    SUM(ss.ss_ext_sales_price) FILTER (WHERE d.d_date IN (SELECT dt FROM ly)) AS ly
  FROM store_sales ss LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
), c AS (
  SELECT i.i_class AS c, MAX(cs.cs_net_profit) AS mx,
    MIN(cs.cs_net_profit) FILTER (WHERE d.d_date BETWEEN DATE '2024-07-16' AND DATE '2024-09-22') AS mn
  FROM catalog_sales cs LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY ALL
), t AS (
  SELECT g.i_class, s.ly AS m0,
    CASE WHEN c.mx > 10 THEN ABS(s.rev) ELSE (SELECT COUNT(*) FROM stg_tpcds_archive_log) END AS m1,
    c.mn AS m2
  FROM (SELECT DISTINCT i_class FROM item WHERE COALESCE(i_class, '') <> 'dresses') g
  LEFT JOIN s ON s.c IS NOT DISTINCT FROM g.i_class
  LEFT JOIN c ON c.c IS NOT DISTINCT FROM g.i_class
)
SELECT * FROM t WHERE m0 IS NOT NULL OR m1 IS NOT NULL OR m2 IS NOT NULL
