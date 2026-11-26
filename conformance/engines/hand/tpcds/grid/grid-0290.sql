SELECT source_type, SUM(row_count) AS v
FROM stg_tpcds_archive_log
GROUP BY source_type
HAVING COUNT(*) IS NOT NULL
