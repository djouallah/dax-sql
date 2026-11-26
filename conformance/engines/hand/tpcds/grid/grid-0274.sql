SELECT source_type, CAST(SUM(row_count) AS DOUBLE) / NULLIF(SUM(row_count), 0) AS r
FROM stg_tpcds_archive_log
GROUP BY source_type
