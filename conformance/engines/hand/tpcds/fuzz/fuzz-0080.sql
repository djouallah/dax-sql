-- COUNTROWS sees no brand row (no CALCULATE): the total; one state only gives the archive rows
SELECT b.i_brand, (SELECT NULLIF(COUNT(*), 0) FROM catalog_sales),
  CASE WHEN (SELECT COUNT(DISTINCT s_state) + MAX(CASE WHEN s_state IS NULL THEN 1 ELSE 0 END) FROM store) = 1
    THEN (SELECT SUM(row_count) FROM stg_tpcds_archive_log) END
FROM (SELECT DISTINCT i_brand FROM item) b
