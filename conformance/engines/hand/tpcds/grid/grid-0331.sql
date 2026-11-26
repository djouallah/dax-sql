SELECT SUM(row_count) AS v
FROM stg_tpcds_archive_log
WHERE source_type IS NOT NULL
