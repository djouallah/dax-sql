SELECT source_type, COUNT(*) AS v
FROM stg_tpcds_archive_log
GROUP BY source_type
ORDER BY v DESC NULLS LAST, source_type NULLS FIRST
