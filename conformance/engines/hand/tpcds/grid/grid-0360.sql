SELECT etag, archive_path, COUNT(*) AS v
FROM stg_tpcds_archive_log
GROUP BY etag, archive_path
