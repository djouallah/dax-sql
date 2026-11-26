-- a store filters no catalog sale: every store name (and the blank row's, when a store sale's store is missing)
-- gets the larger of the archive's file count and all catalog profit, so all tie for the four smallest
WITH v AS (
  SELECT GREATEST((SELECT COUNT(*) FROM stg_tpcds_archive_log), (SELECT SUM(cs_net_profit) FROM catalog_sales)) AS m0
), st AS (
  SELECT DISTINCT s_store_name FROM store
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store))
)
SELECT st.s_store_name, v.m0
FROM st CROSS JOIN v
WHERE v.m0 IS NOT NULL
QUALIFY RANK() OVER (ORDER BY v.m0) <= 4
