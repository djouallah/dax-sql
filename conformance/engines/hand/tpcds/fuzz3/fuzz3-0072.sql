-- per color: store sale rows over every date a quarter on (PARALLELPERIOD +1 QUARTER: whole quarters), twice,
-- plus twice the store revenue YTD (the last date's year, through it), plus the archive's file count
WITH b AS (SELECT date_trunc('quarter', MIN(d_date)) + INTERVAL 3 MONTH AS lo, MAX(d_date) AS hi FROM date_dim),
s AS (
  SELECT i.i_color AS c,
    COUNT(*) FILTER (WHERE d.d_date >= b.lo) AS n,
    SUM(ss.ss_ext_sales_price) FILTER (WHERE d.d_date BETWEEN date_trunc('year', b.hi) AND b.hi) AS ytd
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk CROSS JOIN b
  JOIN item i ON i.i_item_sk = ss.ss_item_sk
  GROUP BY ALL
)
SELECT g.i_color, COALESCE(s.n, 0) * 2 + COALESCE(s.ytd, 0) * 2 + COALESCE((SELECT COUNT(*) FROM stg_tpcds_archive_log), 0) AS m0
FROM (SELECT DISTINCT i_color FROM item) g LEFT JOIN s ON s.c IS NOT DISTINCT FROM g.i_color
