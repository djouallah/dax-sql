SELECT archived_at, COUNT(*) AS v
FROM stg_tpcds_archive_log
GROUP BY ROLLUP (archived_at)
ORDER BY archived_at IS NULL, archived_at NULLS FIRST, GROUPING(archived_at)
