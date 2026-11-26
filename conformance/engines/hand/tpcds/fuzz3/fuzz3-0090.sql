-- the archive is filtered by nothing: its file count beside every store state
SELECT DISTINCT s_state, (SELECT COUNT(*) FROM stg_tpcds_archive_log) AS m0 FROM store
