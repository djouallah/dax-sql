SELECT etag, COUNT(*) AS v
FROM stg_tpcds_archive_log
WHERE COALESCE(archive_path, '') <> 'Files/archive/tpcds/sf10/catalog_sales/part-00000.parquet'
GROUP BY etag
