SELECT etag, COUNT(*) AS v
FROM stg_tpcds_archive_log
WHERE file_stem IS NOT NULL AND (archived_at IS NULL OR archived_at <> TIMESTAMP '2026-09-03 02:15:00')
GROUP BY etag
