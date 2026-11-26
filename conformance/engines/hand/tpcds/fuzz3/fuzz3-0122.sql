-- the archive log is related to nothing: every class ties for the top 2
SELECT DISTINCT i_class, (SELECT NULLIF(COUNT(*), 0) FROM stg_tpcds_archive_log) AS m0 FROM item
