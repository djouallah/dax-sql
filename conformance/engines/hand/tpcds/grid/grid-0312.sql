SELECT etag, COUNT(*) AS v
FROM stg_tpcds_archive_log
GROUP BY etag
HAVING SUM(row_count) IS NOT NULL
