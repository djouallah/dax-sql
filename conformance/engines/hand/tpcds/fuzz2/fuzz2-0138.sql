-- promotion names from "anti" up; per brand and marital status (every pair: 0 when there is no catalog quantity, so
-- never blank): catalog profit, or 0
WITH c AS (
  SELECT i.i_brand, cd.cd_marital_status, SUM(cs.cs_quantity) AS q, SUM(cs.cs_net_profit) AS np
  FROM catalog_sales cs JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk AND p.p_promo_name >= 'anti'
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  GROUP BY ALL
)
SELECT b.i_brand, m.cd_marital_status, CASE WHEN c.q IS NULL THEN 0 ELSE COALESCE(c.np, 0) END AS m0
FROM (SELECT DISTINCT i_brand FROM item) b CROSS JOIN (SELECT DISTINCT cd_marital_status FROM customer_demographics) m
LEFT JOIN c ON c.i_brand IS NOT DISTINCT FROM b.i_brand AND c.cd_marital_status IS NOT DISTINCT FROM m.cd_marital_status
