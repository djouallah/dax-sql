SELECT etag, SUM(row_count) AS v
FROM stg_tpcds_archive_log
GROUP BY etag
HAVING SUM(row_count) > 0
