SELECT row_count, SUM(row_count) AS v
FROM stg_tpcds_archive_log
WHERE COALESCE(file_stem, '') <> 'item'
GROUP BY row_count
