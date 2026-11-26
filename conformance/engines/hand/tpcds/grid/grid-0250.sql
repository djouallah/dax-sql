SELECT row_count, COUNT(*) AS v
FROM stg_tpcds_archive_log
GROUP BY ROLLUP (row_count)
ORDER BY row_count IS NULL, row_count NULLS FIRST, GROUPING(row_count)
