-- every class by every education status, the blank class / status among them when the model has those blank
-- rows (m0 is 1 for each class); promotions other than "pri" (a blank name compares as "": promotions of no
-- name pass, and so do sales of no promotion, the blank row); m1: no category has 1000 quarters
-- (blank); m2: catalog revenue over the most store quantity in the cities Midway and zz-none (a fixed decimal by
-- a whole number: the exact quotient, rounded half away from zero to 4 places)
WITH c AS (
  SELECT i.i_class, cd.cd_education_status, CAST(SUM(cs.cs_ext_sales_price) * 10000 AS HUGEINT) AS rev
  FROM catalog_sales cs
  LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  WHERE COALESCE(p.p_promo_name, '') <> 'pri'
  GROUP BY ALL
), s AS (
  SELECT i.i_class, cd.cd_education_status, MAX(ss.ss_quantity) AS maxq
  FROM store_sales ss
  JOIN store st ON st.s_store_sk = ss.ss_store_sk AND st.s_city IN ('Midway', 'zz-none')
  LEFT JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  WHERE COALESCE(p.p_promo_name, '') <> 'pri'
  GROUP BY ALL
), k AS (
  SELECT i_class FROM item
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_item_sk IS NULL OR ss_item_sk NOT IN (SELECT i_item_sk FROM item))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_item_sk IS NULL OR cs_item_sk NOT IN (SELECT i_item_sk FROM item))
    OR EXISTS (SELECT 1 FROM promotion WHERE p_item_sk IS NULL OR p_item_sk NOT IN (SELECT i_item_sk FROM item))
), e AS (
  SELECT cd_education_status FROM customer_demographics
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_cdemo_sk IS NULL OR ss_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_bill_cdemo_sk IS NULL OR cs_bill_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics)
      OR cs_ship_cdemo_sk IS NULL OR cs_ship_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics))
)
SELECT k.i_class, e.cd_education_status, 1.0 AS m0, NULL::BIGINT AS m1, sign(c.rev) * sign(s.maxq) * ((2 * abs(c.rev) + abs(s.maxq)) // NULLIF(2 * abs(s.maxq), 0)) / 10000 AS m2
FROM k CROSS JOIN e
LEFT JOIN c ON c.i_class IS NOT DISTINCT FROM k.i_class AND c.cd_education_status IS NOT DISTINCT FROM e.cd_education_status
LEFT JOIN s ON s.i_class IS NOT DISTINCT FROM k.i_class AND s.cd_education_status IS NOT DISTINCT FROM e.cd_education_status
