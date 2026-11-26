SELECT archived_at, SUM(row_count) AS v
FROM stg_tpcds_archive_log
GROUP BY ROLLUP (archived_at)
ORDER BY archived_at IS NULL, archived_at
