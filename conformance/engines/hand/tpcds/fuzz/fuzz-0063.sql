-- the archive log is related to nothing: its measures are the same for every class and year (VALUES(d_year)
-- has the blank year too when some sale has no date; the classes, the blank class when item has its blank row)
WITH a AS (SELECT NULLIF(COUNT(*), 0) AS files, SUM(row_count) AS src FROM stg_tpcds_archive_log),
dc AS (
  SELECT i.i_class, COUNT(DISTINCT ss.ss_customer_sk) + MAX(CASE WHEN ss.ss_customer_sk IS NULL THEN 1 ELSE 0 END) AS n
  FROM store_sales ss LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  GROUP BY 1
), y AS (
  SELECT d_year FROM date_dim
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_sold_date_sk IS NULL OR ss_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_sold_date_sk IS NULL OR cs_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
), c AS (
  SELECT i_class FROM item
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_item_sk IS NULL OR ss_item_sk NOT IN (SELECT i_item_sk FROM item))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_item_sk IS NULL OR cs_item_sk NOT IN (SELECT i_item_sk FROM item))
    OR EXISTS (SELECT 1 FROM promotion WHERE p_item_sk IS NULL OR p_item_sk NOT IN (SELECT i_item_sk FROM item))
)
SELECT c.i_class,
  CASE WHEN ROUND(a.files, 1) > 0 THEN (SELECT NULLIF(COUNT(*), 0) FROM y) END,
  ROUND(CASE WHEN dc.n IS NULL AND a.src IS NULL THEN NULL ELSE COALESCE(dc.n * 2, 0) + COALESCE(a.src, 0) END, 2)
FROM c
CROSS JOIN a
LEFT JOIN dc ON dc.i_class IS NOT DISTINCT FROM c.i_class
