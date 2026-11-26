SELECT row_count, COUNT(*) AS v
FROM stg_tpcds_archive_log
WHERE COALESCE(source_type, '') <> 'fact'
GROUP BY row_count
