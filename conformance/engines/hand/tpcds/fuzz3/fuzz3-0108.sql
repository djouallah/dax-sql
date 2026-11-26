-- the archive log is related to nothing: its files for every quarter
SELECT q.d_qoy, (SELECT NULLIF(COUNT(*), 0) FROM stg_tpcds_archive_log) AS m0
FROM (SELECT DISTINCT d_qoy FROM date_dim) q
