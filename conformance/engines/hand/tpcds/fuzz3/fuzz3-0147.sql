-- per color, the largest over every promotion name of: 0 when its catalog quantity a year back is
-- blank, else its store revenue. The OR always holds: INDEX(2) of the colors (blanks first) has
-- items, so their distinct prices are never blank. Then the lowest color (ties kept)
WITH ly AS (
  SELECT i.i_color, p.p_promo_name, SUM(cs.cs_quantity) AS q
  FROM catalog_sales cs
  JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  JOIN date_dim n ON n.d_date = (d.d_date + INTERVAL 1 YEAR)::DATE
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
  GROUP BY ALL
), s AS (
  SELECT i.i_color, p.p_promo_name, SUM(ss.ss_ext_sales_price) AS r
  FROM store_sales ss
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  LEFT JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk
  GROUP BY ALL
), cr AS (
  SELECT i.i_color, p.p_promo_name, SUM(cs.cs_ext_sales_price) AS r
  FROM catalog_sales cs
  JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
    AND d.d_date > (DATE '2024-11-17' - INTERVAL 12 MONTH) AND d.d_date <= DATE '2024-11-17'
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
  GROUP BY ALL
), c2 AS (
  SELECT COUNT(DISTINCT i_current_price) + MAX((i_current_price IS NULL)::INT) AS n
  FROM item WHERE i_color IS NOT DISTINCT FROM (SELECT i_color FROM (SELECT DISTINCT i_color FROM item) ORDER BY i_color NULLS FIRST LIMIT 1 OFFSET 1)
), t AS (
  SELECT co.i_color, MAX(CASE
      WHEN COALESCE(cr.r, 0) > 10 OR NULLIF(c2.n, 0) IS NOT NULL THEN CASE WHEN ly.q IS NULL THEN 0 ELSE s.r END
      ELSE (SELECT COUNT(*) FROM item it WHERE it.i_color IS NOT DISTINCT FROM co.i_color) END) AS m0
  FROM (SELECT DISTINCT i_color FROM item) co
  CROSS JOIN (SELECT DISTINCT p_promo_name FROM promotion) pn
  CROSS JOIN c2
  LEFT JOIN ly ON ly.i_color IS NOT DISTINCT FROM co.i_color AND ly.p_promo_name IS NOT DISTINCT FROM pn.p_promo_name
  LEFT JOIN s ON s.i_color IS NOT DISTINCT FROM co.i_color AND s.p_promo_name IS NOT DISTINCT FROM pn.p_promo_name
  LEFT JOIN cr ON cr.i_color IS NOT DISTINCT FROM co.i_color AND cr.p_promo_name IS NOT DISTINCT FROM pn.p_promo_name
  GROUP BY co.i_color
)
SELECT * FROM t WHERE m0 IS NOT NULL
QUALIFY RANK() OVER (ORDER BY m0) <= 1
