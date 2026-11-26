SELECT source_type, SUM(row_count) AS v
FROM stg_tpcds_archive_log
WHERE archive_path IN ('Files/archive/tpcds/sf10/date_dim/part-00000.parquet') OR NOT (COALESCE(archive_path, '') = 'Files/archive/tpcds/sf10/store_sales/part-00000.parquet')
GROUP BY source_type
