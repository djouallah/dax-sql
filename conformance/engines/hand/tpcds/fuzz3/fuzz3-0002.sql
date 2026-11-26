-- neither the archive log nor catalog_sales is related to store: the same values for every state (the blank row's
-- too, when a store sale's store is missing)
WITH c AS (
  SELECT (SELECT SUM(row_count) FROM stg_tpcds_archive_log) AS src,
         AVG(cs_quantity) AS avg_qty, SUM(cs_net_profit) AS np, SUM(cs_quantity) AS qty
  FROM catalog_sales
), s AS (
  SELECT DISTINCT s_state FROM store
  UNION SELECT NULL WHERE EXISTS (FROM store_sales ANTI JOIN store ON s_store_sk = ss_store_sk)
)
SELECT s.s_state, c.src / NULLIF(c.avg_qty, 0) AS m0, greatest(c.np, c.qty) AS m1
FROM s CROSS JOIN c
