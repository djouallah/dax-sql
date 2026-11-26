SELECT file_stem, SUM(row_count) AS source_rows
FROM stg_tpcds_archive_log
GROUP BY file_stem
HAVING SUM(row_count) IS NOT NULL
