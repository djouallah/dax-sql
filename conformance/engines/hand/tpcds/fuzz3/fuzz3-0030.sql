-- every color x ship-mode type (each with its blank row when some sale's key misses the table; m0 is never blank):
--   m0: the length of the marital statuses joined (no filter reaches customer_demographics; its blank row, an
--       empty string, is one of them when a sale's demographics is missing)
--   m1: catalog profit only if the promotions have one name
WITH np AS (
  SELECT i.i_color, sm.sm_type, SUM(cs.cs_net_profit) AS np
  FROM catalog_sales cs LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk LEFT JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk
  GROUP BY ALL
), one AS (
  SELECT COUNT(DISTINCT p_promo_name) + MAX(CASE WHEN p_promo_name IS NULL THEN 1 ELSE 0 END) = 1 AS one FROM promotion
), ms AS (
  SELECT DISTINCT cd_marital_status FROM customer_demographics
  UNION SELECT NULL WHERE EXISTS (FROM store_sales ANTI JOIN customer_demographics ON cd_demo_sk = ss_cdemo_sk)
                       OR EXISTS (FROM catalog_sales ANTI JOIN customer_demographics ON cd_demo_sk = cs_bill_cdemo_sk)
                       OR EXISTS (FROM catalog_sales ANTI JOIN customer_demographics ON cd_demo_sk = cs_ship_cdemo_sk)
), c AS (
  SELECT DISTINCT i_color FROM item
  UNION SELECT NULL WHERE EXISTS (FROM store_sales ANTI JOIN item ON i_item_sk = ss_item_sk)
                       OR EXISTS (FROM catalog_sales ANTI JOIN item ON i_item_sk = cs_item_sk)
                       OR EXISTS (FROM promotion ANTI JOIN item ON i_item_sk = p_item_sk)
), t AS (
  SELECT DISTINCT sm_type FROM ship_mode
  UNION SELECT NULL WHERE EXISTS (FROM catalog_sales ANTI JOIN ship_mode ON sm_ship_mode_sk = cs_ship_mode_sk)
)
SELECT c.i_color, t.sm_type,
       (SELECT length(COALESCE(string_agg(COALESCE(cd_marital_status, ''), ','), '')) FROM ms) AS m0,
       CASE WHEN one.one THEN np.np END AS m1
FROM c CROSS JOIN t CROSS JOIN one
LEFT JOIN np ON np.i_color IS NOT DISTINCT FROM c.i_color AND np.sm_type IS NOT DISTINCT FROM t.sm_type
