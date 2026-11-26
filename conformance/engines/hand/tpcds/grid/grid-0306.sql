SELECT etag, archive_path, SUM(row_count) AS v
FROM stg_tpcds_archive_log
GROUP BY etag, archive_path
