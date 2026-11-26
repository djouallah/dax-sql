SELECT row_count, SUM(row_count) AS v
FROM stg_tpcds_archive_log
WHERE archived_at IS NOT NULL
GROUP BY row_count
