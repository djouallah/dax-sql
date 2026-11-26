-- per promotion name and ship mode. m0: PREVIOUSMONTH's filter on d_date is removed by ALLEXCEPT(date_dim, d_qoy)
-- (no d_qoy filter), so catalog revenue over every date and category but Shoes, rounded; m1: the largest 2026 store
-- quantity of colours from "coral" up; m2: distinct store customers (no customer counts as one)
WITH c AS (
  SELECT p.p_promo_name, sm.sm_type, ROUND(SUM(cs.cs_ext_sales_price), 0) AS m0
  FROM catalog_sales cs LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
  LEFT JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk
  WHERE i.i_category IS DISTINCT FROM 'Shoes'
  GROUP BY ALL
), s AS (
  SELECT p.p_promo_name,
    MAX(ss.ss_quantity) FILTER (WHERE i.i_color >= 'coral' AND d.d_year = 2026) AS m1,
    COUNT(DISTINCT ss.ss_customer_sk) + MAX(CASE WHEN ss.ss_customer_sk IS NULL THEN 1 ELSE 0 END) AS m2
  FROM store_sales ss LEFT JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
)
SELECT p.p_promo_name, t.sm_type, c.m0, s.m1, s.m2
FROM (SELECT DISTINCT p_promo_name FROM promotion) p CROSS JOIN (SELECT DISTINCT sm_type FROM ship_mode) t
LEFT JOIN c ON c.p_promo_name IS NOT DISTINCT FROM p.p_promo_name AND c.sm_type IS NOT DISTINCT FROM t.sm_type
LEFT JOIN s ON s.p_promo_name IS NOT DISTINCT FROM p.p_promo_name
WHERE c.m0 IS NOT NULL OR s.m1 IS NOT NULL OR s.m2 IS NOT NULL
