-- the archive is filtered by nothing; RANKX's expression has no measure (no context transition), so every month
-- ties and the status ranks 1
SELECT DISTINCT cd_education_status, (SELECT COUNT(*) FROM stg_tpcds_archive_log) AS m0, 1 AS m1
FROM customer_demographics
