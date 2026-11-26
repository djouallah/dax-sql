-- the archive log is related to nothing: every year has the same SUMX, so RANKX is 1, in every
-- month (all tied for the top 2), the blank month too (a sale with no or an unknown date)
SELECT d_moy, 1 FROM (
  SELECT DISTINCT d_moy FROM date_dim
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_sold_date_sk IS NULL OR ss_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_sold_date_sk IS NULL OR cs_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
)
WHERE EXISTS (SELECT 1 FROM stg_tpcds_archive_log)
