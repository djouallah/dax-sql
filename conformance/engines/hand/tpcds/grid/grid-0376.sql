SELECT row_count, COUNT(*) AS v
FROM stg_tpcds_archive_log
WHERE COALESCE(row_count, 0) >= 1096 OR COALESCE(source_type, '') <> 'dimension'
GROUP BY row_count
