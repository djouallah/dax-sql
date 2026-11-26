-- promotion names from "anti" up; per brand and marital status (every pair, the blank rows' too when a sale's
-- item or demographics is missing: 0 when there is no catalog quantity, so never blank): catalog profit, or 0
WITH c AS (
  SELECT i.i_brand, cd.cd_marital_status, SUM(cs.cs_quantity) AS q, SUM(cs.cs_net_profit) AS np
  FROM catalog_sales cs JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk AND p.p_promo_name >= 'anti'
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  GROUP BY ALL
), b AS (
  SELECT DISTINCT i_brand FROM item
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_item_sk IS NULL OR ss_item_sk NOT IN (SELECT i_item_sk FROM item))
                       OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_item_sk IS NULL OR cs_item_sk NOT IN (SELECT i_item_sk FROM item))
                       OR EXISTS (SELECT 1 FROM promotion WHERE p_item_sk IS NULL OR p_item_sk NOT IN (SELECT i_item_sk FROM item))
), m AS (
  SELECT DISTINCT cd_marital_status FROM customer_demographics
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_cdemo_sk IS NULL OR ss_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics))
                       OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_bill_cdemo_sk IS NULL OR cs_ship_cdemo_sk IS NULL
                                    OR cs_bill_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics)
                                    OR cs_ship_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics))
)
SELECT b.i_brand, m.cd_marital_status, CASE WHEN c.q IS NULL THEN 0 ELSE COALESCE(c.np, 0) END AS m0
FROM b CROSS JOIN m
LEFT JOIN c ON c.i_brand IS NOT DISTINCT FROM b.i_brand AND c.cd_marital_status IS NOT DISTINCT FROM m.cd_marital_status
