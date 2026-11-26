-- store sales to Secondary and 2 yr Degree customers (the ship modes reach no store sale); a blank compares as 0
-- in a two-argument MAX; m2 only when the stores have one state (store's blank row, sales of no store, adds
-- a blank state): revenue against every date a year back
WITH shift AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), s AS (
  SELECT SUM(ss.ss_net_profit) AS profit,
    CAST(SUM(ss.ss_ext_sales_price) * 10000 AS HUGEINT) AS sm, NULLIF(COUNT(ss.ss_ext_sales_price), 0) AS n,
    SUM(ss.ss_ext_sales_price) FILTER (WHERE d.d_date IN (SELECT ly FROM shift)) AS rev_ly
  FROM store_sales ss
  JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk AND cd.cd_education_status IN ('Secondary', '2 yr Degree')
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
), t AS (
  SELECT profit, sign(sm) * ((2 * abs(sm) + n) // (2 * n)) / 10000 AS avgp,
    (SELECT NULLIF(COUNT(*), 0) FROM stg_tpcds_archive_log) AS files,
    CASE WHEN (SELECT COUNT(DISTINCT s_state) + (COUNT(*) > COUNT(s_state) OR EXISTS (SELECT 1 FROM store_sales
                 WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store)))::INT FROM store) = 1
         THEN rev_ly END AS m2
  FROM s
), u AS (
  SELECT profit AS m0,
    CASE WHEN COALESCE(files, 0) > COALESCE(avgp, 0) THEN files WHEN COALESCE(avgp, 0) > COALESCE(files, 0) THEN avgp ELSE COALESCE(files, avgp) END AS m1,
    m2
  FROM t
)
SELECT * FROM u WHERE m0 IS NOT NULL OR m1 IS NOT NULL OR m2 IS NOT NULL
