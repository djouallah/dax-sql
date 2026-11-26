SELECT file_stem, COUNT(*) AS v
FROM stg_tpcds_archive_log
WHERE row_count IS NOT NULL
GROUP BY file_stem
