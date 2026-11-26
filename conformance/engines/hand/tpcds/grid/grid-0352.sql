SELECT etag, CAST(COUNT(*) AS DOUBLE) / COUNT(*) AS r
FROM stg_tpcds_archive_log
GROUP BY etag
