SELECT row_count, SUM(row_count) AS v
FROM stg_tpcds_archive_log
WHERE COALESCE(source_filename, '') <> 'item/part-00000.parquet' OR COALESCE(source_type, '') <> 'dimension'
GROUP BY row_count
