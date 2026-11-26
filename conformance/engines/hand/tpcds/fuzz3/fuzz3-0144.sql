-- every promotion name with every quarter; the brand filter keeps items from "exportcorp #7" on
-- (a blank brand is "", before it). Names and quarters include the blank row when some sale has no promotion,
-- no date (its sales there)
WITH c AS (
  SELECT p.p_promo_name, d.d_qoy, MIN(cs.cs_ext_sales_price) AS mn
  FROM catalog_sales cs
  JOIN item i ON i.i_item_sk = cs.cs_item_sk AND i.i_brand >= 'exportcorp #7'
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
  GROUP BY ALL
)
SELECT pn.p_promo_name, q.d_qoy, c.mn AS m0
FROM (SELECT p_promo_name FROM promotion
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales ANTI JOIN promotion ON p_promo_sk = ss_promo_sk)
    OR EXISTS (SELECT 1 FROM catalog_sales ANTI JOIN promotion ON p_promo_sk = cs_promo_sk)) pn
CROSS JOIN (SELECT d_qoy FROM date_dim
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales ANTI JOIN date_dim ON d_date_sk_1 = ss_sold_date_sk)
    OR EXISTS (SELECT 1 FROM catalog_sales ANTI JOIN date_dim ON d_date_sk_1 = cs_sold_date_sk)) q
LEFT JOIN c ON c.p_promo_name IS NOT DISTINCT FROM pn.p_promo_name AND c.d_qoy IS NOT DISTINCT FROM q.d_qoy
