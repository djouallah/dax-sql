SELECT row_count, SUM(row_count) AS v
FROM stg_tpcds_archive_log
WHERE archived_at IS NOT NULL AND source_type IN ('fact', 'dimension')
GROUP BY row_count
