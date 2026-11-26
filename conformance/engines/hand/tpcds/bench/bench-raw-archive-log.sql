SELECT source_type, COUNT(*), SUM(row_count) FROM stg_tpcds_archive_log GROUP BY source_type
