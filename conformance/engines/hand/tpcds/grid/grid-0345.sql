SELECT row_count, source_type, COUNT(*) AS v
FROM stg_tpcds_archive_log
GROUP BY row_count, source_type
