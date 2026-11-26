SELECT SUM(row_count) AS v
FROM stg_tpcds_archive_log
WHERE source_filename IN ('catalog_sales/part-00000.parquet')
