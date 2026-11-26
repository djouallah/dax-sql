-- the archive is filtered by nothing: its file count beside every store state, and the blank row's when some
-- store sale has no store
SELECT s_state, (SELECT COUNT(*) FROM stg_tpcds_archive_log) AS m0
FROM (SELECT s_state FROM store
      UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales ANTI JOIN store ON s_store_sk = ss_store_sk))
