SELECT etag, SUM(row_count) AS v
FROM stg_tpcds_archive_log
WHERE source_type = 'fact' AND COALESCE(etag, '') <> 'sf10-26dc'
GROUP BY etag
