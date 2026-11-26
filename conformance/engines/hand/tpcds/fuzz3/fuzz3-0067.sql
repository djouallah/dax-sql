-- the archive log is filtered by nothing here: its file count and rows beside each class of the brand's items
SELECT DISTINCT i_class, (SELECT COUNT(*) FROM stg_tpcds_archive_log) AS m0, (SELECT SUM(row_count) FROM stg_tpcds_archive_log) AS m1
FROM item WHERE i_brand = 'importcorp #1'
