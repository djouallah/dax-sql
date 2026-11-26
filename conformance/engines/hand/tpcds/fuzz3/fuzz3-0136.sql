-- one row: HASONEVALUE of the category over every item is false; the prices joined by "|" from the
-- lowest (as DAX writes them: no trailing zeros), their first 2 characters
WITH one AS (SELECT COUNT(DISTINCT i_category) + MAX((i_category IS NULL)::INT) = 1 AS one FROM item)
SELECT CASE WHEN one.one THEN
    CASE WHEN (SELECT COUNT(*) FROM stg_tpcds_archive_log) = 0 THEN 0 ELSE (SELECT SUM(ss_net_profit) FROM store_sales) END
  END AS m0,
  (SELECT ROUND(NULLIF(COUNT(DISTINCT ss_customer_sk) + MAX((ss_customer_sk IS NULL)::INT), 0), 0) FROM store_sales) AS m1,
  (SELECT LENGTH(LEFT(UPPER(STRING_AGG(COALESCE(CAST(CAST(i_current_price AS DOUBLE) AS VARCHAR), ''), '|' ORDER BY i_current_price NULLS FIRST)), 2))
   FROM (SELECT DISTINCT i_current_price FROM item)) AS m2
FROM one
