SELECT etag, SUM(row_count) AS v
FROM stg_tpcds_archive_log
WHERE row_count IS NOT NULL OR COALESCE(etag, '') <> 'sf10-1f3a'
GROUP BY etag
