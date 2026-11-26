SELECT source_type, COUNT(*) AS v
FROM stg_tpcds_archive_log
GROUP BY source_type
