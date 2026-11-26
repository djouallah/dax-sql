SELECT NULLIF(COUNT(*), 0) AS v
FROM stg_tpcds_archive_log
WHERE COALESCE(source_type, '') <> 'fact'
