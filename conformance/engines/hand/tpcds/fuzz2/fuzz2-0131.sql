-- a store filters no catalog sale: every store name gets the larger of the archive's file count and all catalog
-- profit, so all tie for the four smallest
WITH v AS (
  SELECT GREATEST((SELECT COUNT(*) FROM stg_tpcds_archive_log), (SELECT SUM(cs_net_profit) FROM catalog_sales)) AS m0
)
SELECT st.s_store_name, v.m0
FROM (SELECT DISTINCT s_store_name FROM store) st CROSS JOIN v
WHERE v.m0 IS NOT NULL
QUALIFY RANK() OVER (ORDER BY v.m0) <= 4
