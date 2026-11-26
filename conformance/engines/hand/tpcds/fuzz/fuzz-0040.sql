-- no filter reaches the archive log: its files, for each quarter number (the blank one too, when some sale has
-- no date)
SELECT q.d_qoy, (SELECT NULLIF(COUNT(*), 0) FROM stg_tpcds_archive_log) AS m0
FROM (SELECT d_qoy FROM date_dim
      UNION SELECT NULL
      WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_sold_date_sk IS NULL OR ss_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
     OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_sold_date_sk IS NULL OR cs_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))) q
WHERE m0 IS NOT NULL
