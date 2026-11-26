SELECT etag, COUNT(*) AS v
FROM stg_tpcds_archive_log
WHERE COALESCE(source_type, '') <> 'fact' OR archive_path = 'Files/archive/tpcds/sf10/store/part-00000.parquet'
GROUP BY etag
