SELECT file_stem, archive_path, SUM(row_count) AS v
FROM stg_tpcds_archive_log
GROUP BY file_stem, archive_path
