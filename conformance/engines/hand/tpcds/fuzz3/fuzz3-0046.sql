-- ISINSCOPE is false: the archive's files for every city (the log is related to no store); the
-- first 2 cities ascending (blank first: store's blank row, when sales of no store give it one)
WITH m AS (
  SELECT c.s_city, (SELECT NULLIF(COUNT(*), 0) FROM stg_tpcds_archive_log) AS m0
  FROM (SELECT DISTINCT s_city FROM store UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store))) c
)
SELECT s_city, m0 FROM m QUALIFY rank() OVER (ORDER BY m0 DESC NULLS LAST, s_city NULLS FIRST) <= 2
