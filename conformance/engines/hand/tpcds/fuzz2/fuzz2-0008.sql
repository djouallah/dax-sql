-- the archive's files: nothing in the filters (stores, colors, dates) reaches the archive log
SELECT n FROM (SELECT COUNT(*) AS n FROM stg_tpcds_archive_log) WHERE n > 0
