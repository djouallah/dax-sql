-- ISINSCOPE is false: the archive's files for every city (the log is related to no store); the
-- first 2 cities ascending (blank last)
WITH m AS (
  SELECT c.s_city, (SELECT NULLIF(COUNT(*), 0) FROM stg_tpcds_archive_log) AS m0 FROM (SELECT DISTINCT s_city FROM store) c
)
SELECT s_city, m0 FROM m QUALIFY rank() OVER (ORDER BY m0 DESC NULLS LAST, s_city NULLS FIRST) <= 2
