SELECT file_stem, COUNT(*) AS v
FROM stg_tpcds_archive_log
WHERE source_type IS NOT NULL
GROUP BY file_stem
