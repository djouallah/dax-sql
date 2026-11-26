-- the archive log is related to nothing: its measures are the same for every class and year
WITH a AS (SELECT NULLIF(COUNT(*), 0) AS files, SUM(row_count) AS src FROM stg_tpcds_archive_log),
dc AS (
  SELECT i.i_class, COUNT(DISTINCT ss.ss_customer_sk) + MAX(CASE WHEN ss.ss_customer_sk IS NULL THEN 1 ELSE 0 END) AS n
  FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk
  GROUP BY 1
)
SELECT c.i_class,
  CASE WHEN ROUND(a.files, 1) > 0 THEN (SELECT NULLIF(COUNT(DISTINCT d_year), 0) FROM date_dim) END,
  ROUND(CASE WHEN dc.n IS NULL AND a.src IS NULL THEN NULL ELSE COALESCE(dc.n * 2, 0) + COALESCE(a.src, 0) END, 2)
FROM (SELECT DISTINCT i_class FROM item) c
CROSS JOIN a
LEFT JOIN dc ON dc.i_class IS NOT DISTINCT FROM c.i_class
