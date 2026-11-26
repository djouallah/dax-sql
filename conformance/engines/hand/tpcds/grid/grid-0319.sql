SELECT etag, SUM(row_count) AS v
FROM stg_tpcds_archive_log
WHERE archived_at IS NULL OR archived_at <> TIMESTAMP '2026-09-03 02:15:00'
GROUP BY etag
