SELECT row_count, CAST(SUM(row_count) AS DOUBLE) / NULLIF(SUM(row_count), 0) AS r
FROM stg_tpcds_archive_log
GROUP BY row_count
