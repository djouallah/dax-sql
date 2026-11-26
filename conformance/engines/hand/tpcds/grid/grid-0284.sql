SELECT source_type, source_filename, COUNT(*) AS v
FROM stg_tpcds_archive_log
GROUP BY source_type, source_filename
