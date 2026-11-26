SELECT etag, SUM(row_count) AS v
FROM stg_tpcds_archive_log
GROUP BY etag
HAVING COUNT(*) > 0
