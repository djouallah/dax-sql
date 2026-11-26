SELECT row_count, archived_at, COUNT(*) AS v
FROM stg_tpcds_archive_log
GROUP BY row_count, archived_at
