-- every color x ship-mode type (m0 is never blank):
--   m0: the length of the marital statuses joined (no filter reaches customer_demographics)
--   m1: catalog profit only if the promotions have one name
WITH np AS (
  SELECT i.i_color, sm.sm_type, SUM(cs.cs_net_profit) AS np
  FROM catalog_sales cs LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk LEFT JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk
  GROUP BY ALL
), one AS (
  SELECT COUNT(DISTINCT p_promo_name) + MAX(CASE WHEN p_promo_name IS NULL THEN 1 ELSE 0 END) = 1 AS one FROM promotion
)
SELECT c.i_color, t.sm_type,
       (SELECT length(COALESCE(string_agg(COALESCE(cd_marital_status, ''), ','), '')) FROM (SELECT DISTINCT cd_marital_status FROM customer_demographics)) AS m0,
       CASE WHEN one.one THEN np.np END AS m1
FROM (SELECT DISTINCT i_color FROM item) c CROSS JOIN (SELECT DISTINCT sm_type FROM ship_mode) t CROSS JOIN one
LEFT JOIN np ON np.i_color IS NOT DISTINCT FROM c.i_color AND np.sm_type IS NOT DISTINCT FROM t.sm_type
