-- the archive log is related to nothing: its files for every category
SELECT DISTINCT i_category, (SELECT NULLIF(COUNT(*), 0) FROM stg_tpcds_archive_log) AS m0 FROM item
