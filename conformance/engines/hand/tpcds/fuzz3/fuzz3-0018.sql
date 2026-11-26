-- HASONEVALUE(d_qoy) with no date filter: only if the dates have one quarter number
SELECT sm.sm_type, (SELECT SUM(row_count) FROM stg_tpcds_archive_log) AS m0
FROM (SELECT DISTINCT sm_type FROM ship_mode) sm
WHERE (SELECT COUNT(DISTINCT d_qoy) + MAX(CASE WHEN d_qoy IS NULL THEN 1 ELSE 0 END) FROM date_dim) = 1
  AND (SELECT SUM(row_count) FROM stg_tpcds_archive_log) IS NOT NULL
