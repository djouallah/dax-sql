SELECT row_count, COUNT(*) * 2 AS a, COUNT(*) + 1 AS b, COUNT(*) AS c
FROM stg_tpcds_archive_log
GROUP BY row_count
