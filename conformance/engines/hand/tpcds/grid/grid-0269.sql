SELECT etag, COUNT(*) AS v
FROM stg_tpcds_archive_log
GROUP BY etag
ORDER BY etag NULLS FIRST
