SELECT file_stem, COUNT(*) AS v
FROM stg_tpcds_archive_log
GROUP BY file_stem
