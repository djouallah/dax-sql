SELECT file_stem, SUM(row_count) AS v
FROM stg_tpcds_archive_log
WHERE archived_at IS NULL OR archived_at <> TIMESTAMP '2026-09-05 04:15:00' OR COALESCE(row_count, 0) BETWEEN 6 AND 380
GROUP BY file_stem
