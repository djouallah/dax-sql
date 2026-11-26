-- a date filter does not reach the promotion table: its names
SELECT
  (SELECT NULLIF(COUNT(DISTINCT p_promo_name) + MAX(CASE WHEN p_promo_name IS NULL THEN 1 ELSE 0 END), 0) FROM promotion),
  (SELECT ABS(MAX(ss_ext_sales_price)) FROM store_sales),
  (SELECT ABS(NULLIF(COUNT(*), 0)) FROM stg_tpcds_archive_log)
