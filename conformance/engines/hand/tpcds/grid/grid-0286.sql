SELECT source_type, COUNT(*) AS v
FROM stg_tpcds_archive_log
WHERE COALESCE(source_filename, '') <> 'date_dim/part-00000.parquet' AND source_filename IN ('store_sales/part-00000.parquet', 'item/part-00000.parquet')
GROUP BY source_type
