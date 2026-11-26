SELECT SUM(row_count) AS v
FROM stg_tpcds_archive_log
WHERE NOT (COALESCE(etag, '') = 'sf10-2aad')
