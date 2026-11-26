-- HASONEVALUE of the year over the whole calendar is false: DIVIDE by blank, every status blank;
-- the top 5 by it (blank last), then by status
WITH one AS (SELECT COUNT(DISTINCT d_year) + MAX((d_year IS NULL)::INT) = 1 AS one FROM date_dim),
s AS (
  SELECT cd.cd_marital_status, MIN(ss.ss_net_profit) AS mn, MAX(ss.ss_quantity) AS mq, AVG(ss.ss_quantity) AS av
  FROM store_sales ss JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk GROUP BY ALL
), t AS (
  SELECT m.cd_marital_status,
    CASE WHEN COALESCE(s.mn, 0) > 1000 THEN s.mq ELSE (SELECT SUM(row_count) FROM stg_tpcds_archive_log) END
      / NULLIF(CASE WHEN one.one THEN s.av END, 0) AS m0
  FROM (SELECT DISTINCT cd_marital_status FROM customer_demographics) m CROSS JOIN one
  LEFT JOIN s ON s.cd_marital_status IS NOT DISTINCT FROM m.cd_marital_status
)
SELECT * FROM t
QUALIFY RANK() OVER (ORDER BY m0 DESC NULLS LAST, cd_marital_status NULLS FIRST) <= 5
