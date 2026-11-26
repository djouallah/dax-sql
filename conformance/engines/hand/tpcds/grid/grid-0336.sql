SELECT row_count, CAST(COUNT(*) AS DOUBLE) / COUNT(*) AS r
FROM stg_tpcds_archive_log
GROUP BY row_count
