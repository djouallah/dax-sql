SELECT etag, COUNT(*) AS a, COUNT(*) AS b
FROM stg_tpcds_archive_log
GROUP BY etag
