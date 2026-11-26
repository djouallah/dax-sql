SELECT file_stem, SUM(row_count) AS v
FROM stg_tpcds_archive_log
GROUP BY file_stem
ORDER BY v DESC NULLS LAST, file_stem NULLS FIRST
