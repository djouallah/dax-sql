-- two brands: per ship mode and month, the number of promotion names whose catalog revenue is over 10 (a sale with
-- no or an unknown ship mode, date or promotion in that table's blank row: the blank type, month or name)
WITH r AS (
  SELECT sm.sm_type, d.d_moy, p.p_promo_name, SUM(cs.cs_ext_sales_price) AS rev
  FROM catalog_sales cs JOIN item i ON i.i_item_sk = cs.cs_item_sk AND i.i_brand IN ('edupack #2', 'scholarpack #6')
  LEFT JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
  GROUP BY ALL
)
SELECT sm_type, d_moy, COUNT(*) AS m0
FROM r WHERE rev > 10
GROUP BY ALL
