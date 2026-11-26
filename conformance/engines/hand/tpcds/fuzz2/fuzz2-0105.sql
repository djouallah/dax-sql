-- per month and ship mode (every pair: m0 is never blank, the archive's rows being added):
-- m0 = the largest, over education statuses, of 2 x the average blue catalog sale + the archive's rows;
-- m1 = rank, among customer states, of 2 x catalog profit + store profit (ship mode filters only the catalog)
WITH asr AS (
  SELECT SUM(row_count) AS n FROM stg_tpcds_archive_log
), av AS (
  SELECT d.d_moy, sm.sm_type, cd.cd_education_status, ROUND(AVG(cs.cs_ext_sales_price), 4) AS a
  FROM catalog_sales cs JOIN item i ON i.i_item_sk = cs.cs_item_sk AND i.i_color = 'blue'
  JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  GROUP BY ALL
), g AS (
  SELECT m.d_moy, t.sm_type FROM (SELECT DISTINCT d_moy FROM date_dim) m CROSS JOIN (SELECT DISTINCT sm_type FROM ship_mode) t
), m0 AS (
  SELECT g.d_moy, g.sm_type, MAX(COALESCE(2 * av.a, 0) + (SELECT n FROM asr)) AS m0
  FROM g CROSS JOIN (SELECT DISTINCT cd_education_status FROM customer_demographics) e
  LEFT JOIN av ON av.d_moy = g.d_moy AND av.sm_type IS NOT DISTINCT FROM g.sm_type AND av.cd_education_status IS NOT DISTINCT FROM e.cd_education_status
  GROUP BY ALL
), c AS (
  SELECT d.d_moy, sm.sm_type, ca.ca_state, SUM(cs.cs_net_profit) AS np
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk
  LEFT JOIN customer_address ca ON ca.ca_address_sk = cs.cs_bill_addr_sk
  GROUP BY ALL
), s AS (
  SELECT d.d_moy, ca.ca_state, SUM(ss.ss_net_profit) AS np
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  LEFT JOIN customer_address ca ON ca.ca_address_sk = ss.ss_addr_sk
  GROUP BY ALL
), v AS (
  SELECT g.d_moy, g.sm_type, st.ca_state, COALESCE(2 * c.np, 0) + COALESCE(s.np, 0) AS v
  FROM g CROSS JOIN (SELECT DISTINCT ca_state FROM customer_address) st
  LEFT JOIN c ON c.d_moy = g.d_moy AND c.sm_type IS NOT DISTINCT FROM g.sm_type AND c.ca_state IS NOT DISTINCT FROM st.ca_state
  LEFT JOIN s ON s.d_moy = g.d_moy AND s.ca_state IS NOT DISTINCT FROM st.ca_state
), cur AS (
  SELECT g.d_moy, g.sm_type,
    COALESCE(2 * (SELECT SUM(np) FROM c WHERE c.d_moy = g.d_moy AND c.sm_type IS NOT DISTINCT FROM g.sm_type), 0)
      + COALESCE((SELECT SUM(np) FROM s WHERE s.d_moy = g.d_moy), 0) AS v
  FROM g
)
SELECT m0.d_moy, m0.sm_type, m0.m0,
  1 + (SELECT COUNT(*) FROM v WHERE v.d_moy = cur.d_moy AND v.sm_type IS NOT DISTINCT FROM cur.sm_type AND v.v > cur.v) AS m1
FROM m0 JOIN cur ON cur.d_moy = m0.d_moy AND cur.sm_type IS NOT DISTINCT FROM m0.sm_type
