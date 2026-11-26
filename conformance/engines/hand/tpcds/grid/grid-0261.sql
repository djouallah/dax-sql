SELECT source_type, COUNT(*) AS a, SUM(row_count) AS b
FROM stg_tpcds_archive_log
GROUP BY source_type
