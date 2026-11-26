SELECT etag, SUM(row_count) AS a, SUM(row_count) AS b
FROM stg_tpcds_archive_log
GROUP BY etag
