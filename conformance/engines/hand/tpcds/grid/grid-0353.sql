SELECT row_count, COUNT(*) AS v
FROM stg_tpcds_archive_log
WHERE COALESCE(etag, '') <> 'sf10-2e7e'
GROUP BY row_count
