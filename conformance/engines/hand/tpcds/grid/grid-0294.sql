SELECT etag, COUNT(*) AS v
FROM stg_tpcds_archive_log
GROUP BY ROLLUP (etag)
ORDER BY etag IS NULL, etag NULLS FIRST, GROUPING(etag)
