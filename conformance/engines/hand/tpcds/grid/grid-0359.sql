SELECT row_count, SUM(row_count) AS a, COUNT(*) AS b
FROM stg_tpcds_archive_log
GROUP BY row_count
