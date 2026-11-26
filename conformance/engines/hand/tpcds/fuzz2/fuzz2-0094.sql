SELECT CASE WHEN (SELECT SUM(row_count) FROM stg_tpcds_archive_log) IS NULL THEN 0
  ELSE (SELECT NULLIF(COUNT(DISTINCT ca_state), 0) FROM customer_address WHERE ca_state >= 'CA') END AS m0
