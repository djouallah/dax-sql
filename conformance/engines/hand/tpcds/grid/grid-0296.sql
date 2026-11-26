SELECT etag, CAST(COUNT(*) AS DOUBLE) / NULLIF(SUM(row_count), 0) AS r
FROM stg_tpcds_archive_log
GROUP BY etag
