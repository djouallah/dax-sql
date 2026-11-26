-- one row: the dense rank of a profit every brand shares (1), store sales when there is a catalog price
-- (else 0), and archive files (store name never in scope)
SELECT 1 AS m0,
  CASE WHEN (SELECT MIN(cs_ext_sales_price) FROM catalog_sales) IS NULL THEN 0 ELSE (SELECT NULLIF(COUNT(*), 0) FROM store_sales) END AS m1,
  (SELECT NULLIF(COUNT(*), 0) FROM stg_tpcds_archive_log) AS m2
