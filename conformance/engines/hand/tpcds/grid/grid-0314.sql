SELECT row_count, COUNT(*) AS v
FROM stg_tpcds_archive_log
GROUP BY row_count
ORDER BY v DESC, row_count NULLS FIRST
