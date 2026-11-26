-- every class by every education status (m0 is 1 for each class); promotions other than "pri" (a blank name
-- compares as "": promotions of no name pass, sales of no promotion do not); m1: no category has 1000 quarters
-- (blank); m2: catalog revenue over the most store quantity in the cities Midway and zz-none (a fixed decimal by
-- a whole number: the exact quotient, rounded half away from zero to 4 places)
WITH c AS (
  SELECT i.i_class, cd.cd_education_status, CAST(SUM(cs.cs_ext_sales_price) * 10000 AS HUGEINT) AS rev
  FROM catalog_sales cs
  JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk AND COALESCE(p.p_promo_name, '') <> 'pri'
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  GROUP BY ALL
), s AS (
  SELECT i.i_class, cd.cd_education_status, MAX(ss.ss_quantity) AS maxq
  FROM store_sales ss
  JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk AND COALESCE(p.p_promo_name, '') <> 'pri'
  JOIN store st ON st.s_store_sk = ss.ss_store_sk AND st.s_city IN ('Midway', 'zz-none')
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  GROUP BY ALL
)
SELECT k.i_class, e.cd_education_status, 1.0 AS m0, NULL::BIGINT AS m1, sign(c.rev) * sign(s.maxq) * ((2 * abs(c.rev) + abs(s.maxq)) // NULLIF(2 * abs(s.maxq), 0)) / 10000 AS m2
FROM (SELECT DISTINCT i_class FROM item) k CROSS JOIN (SELECT DISTINCT cd_education_status FROM customer_demographics) e
LEFT JOIN c ON c.i_class IS NOT DISTINCT FROM k.i_class AND c.cd_education_status IS NOT DISTINCT FROM e.cd_education_status
LEFT JOIN s ON s.i_class IS NOT DISTINCT FROM k.i_class AND s.cd_education_status IS NOT DISTINCT FROM e.cd_education_status
