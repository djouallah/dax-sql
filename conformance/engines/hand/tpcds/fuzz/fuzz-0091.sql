-- the archive log is related to nothing: its rows for every price
SELECT
  (SELECT ROUND(CASE WHEN MAX(cs_ext_sales_price) IS NULL AND MIN(cs_ext_sales_price) IS NULL THEN NULL
                     ELSE COALESCE(MAX(cs_ext_sales_price) * 2, 0) + COALESCE(MIN(cs_ext_sales_price), 0) END, 2) FROM catalog_sales),
  (SELECT CASE WHEN EXISTS (SELECT 1 FROM item) THEN NULLIF(COUNT(*), 0) END FROM stg_tpcds_archive_log)
