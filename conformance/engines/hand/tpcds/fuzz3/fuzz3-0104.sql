-- SELECTEDVALUE of the marital status over every status is blank, never "S": Archive Files when
-- the pair's items have store sales (a distinct count above 0), else their least catalog profit
WITH s AS (
  SELECT i.i_color, i.i_category, TRUE AS sold
  FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk GROUP BY ALL
), c AS (
  SELECT i.i_color, i.i_category, MIN(cs.cs_net_profit) AS mn
  FROM catalog_sales cs JOIN item i ON i.i_item_sk = cs.cs_item_sk GROUP BY ALL
), sel AS (
  SELECT CASE WHEN COUNT(DISTINCT cd_marital_status) + MAX((cd_marital_status IS NULL)::INT) = 1 THEN MIN(cd_marital_status) END AS ms
  FROM customer_demographics
)
SELECT co.i_color, ca.i_category,
  CASE WHEN COALESCE(sel.ms, '') = 'S' THEN c.mn
       WHEN s.sold THEN (SELECT NULLIF(COUNT(*), 0) FROM stg_tpcds_archive_log)
       ELSE c.mn END AS m0
FROM (SELECT DISTINCT i_color FROM item) co
CROSS JOIN (SELECT DISTINCT i_category FROM item) ca
CROSS JOIN sel
LEFT JOIN s ON s.i_color IS NOT DISTINCT FROM co.i_color AND s.i_category IS NOT DISTINCT FROM ca.i_category
LEFT JOIN c ON c.i_color IS NOT DISTINCT FROM co.i_color AND c.i_category IS NOT DISTINCT FROM ca.i_category
