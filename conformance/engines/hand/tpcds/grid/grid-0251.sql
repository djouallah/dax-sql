SELECT source_type, COUNT(*) * 2 AS a, COALESCE(COUNT(*), 0) + 1 AS b, COALESCE(COUNT(*), 0) AS c
FROM stg_tpcds_archive_log
GROUP BY source_type
