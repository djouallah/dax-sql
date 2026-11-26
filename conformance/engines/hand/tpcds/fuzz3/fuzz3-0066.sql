-- each year's YTD context holds one year: the larger of the archive's file count and 1, every year tied
SELECT DISTINCT d_year, GREATEST((SELECT COUNT(*) FROM stg_tpcds_archive_log), 1) AS m0 FROM date_dim
