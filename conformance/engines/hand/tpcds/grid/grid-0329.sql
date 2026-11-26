SELECT file_stem, COUNT(*) AS v
FROM stg_tpcds_archive_log
WHERE archive_path = 'Files/archive/tpcds/sf10/store_sales/part-00000.parquet' AND archive_path IN ('Files/archive/tpcds/sf10/date_dim/part-00000.parquet', 'Files/archive/tpcds/sf10/item/part-00000.parquet')
GROUP BY file_stem
