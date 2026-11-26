-- every promotion name with every quarter; the brand filter keeps items from "exportcorp #7" on
-- (a blank brand is "", before it)
WITH c AS (
  SELECT p.p_promo_name, d.d_qoy, MIN(cs.cs_ext_sales_price) AS mn
  FROM catalog_sales cs
  JOIN item i ON i.i_item_sk = cs.cs_item_sk AND i.i_brand >= 'exportcorp #7'
  JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
  GROUP BY ALL
)
SELECT pn.p_promo_name, q.d_qoy, c.mn AS m0
FROM (SELECT DISTINCT p_promo_name FROM promotion) pn
CROSS JOIN (SELECT DISTINCT d_qoy FROM date_dim) q
LEFT JOIN c ON c.p_promo_name IS NOT DISTINCT FROM pn.p_promo_name AND c.d_qoy = q.d_qoy
