SELECT row_count, COUNT(*) AS a, SUM(row_count) AS b
FROM stg_tpcds_archive_log
GROUP BY row_count
