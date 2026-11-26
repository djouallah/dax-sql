SELECT file_stem, COUNT(*) AS a, SUM(row_count) AS b
FROM stg_tpcds_archive_log
GROUP BY file_stem
