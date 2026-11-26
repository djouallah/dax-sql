-- no filter reaches the archive log: its files, for each quarter number
SELECT q.d_qoy, (SELECT NULLIF(COUNT(*), 0) FROM stg_tpcds_archive_log) AS m0
FROM (SELECT DISTINCT d_qoy FROM date_dim) q
WHERE m0 IS NOT NULL
