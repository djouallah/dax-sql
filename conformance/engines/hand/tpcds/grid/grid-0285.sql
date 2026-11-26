SELECT source_type, COUNT(*) AS v
FROM stg_tpcds_archive_log
WHERE COALESCE(etag, '') <> 'sf10-230b'
GROUP BY source_type
