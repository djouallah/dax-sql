-- the archive log is related to nothing: every year has the same SUMX, so RANKX is 1, in every
-- month (all tied for the top 2)
SELECT DISTINCT d_moy, 1 FROM date_dim
WHERE EXISTS (SELECT 1 FROM stg_tpcds_archive_log)
