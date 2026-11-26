-- In 2025: twice the absolute share of the (promotion, color)'s store profit in the promotion's (all items),
-- plus the average over the color's classes of their store revenue YoY (2025 against its dates a year back).
-- COALESCE(..., 0) is never blank, so the IF always takes that branch.
WITH cur AS (SELECT d_date AS dt FROM date_dim WHERE d_year = 2025),
ly AS (
  SELECT (dt - INTERVAL 1 YEAR)::DATE AS dt FROM cur
  UNION SELECT last_day((dt - INTERVAL 1 YEAR)::DATE) FROM cur WHERE dt = last_day(dt)),
f AS (
  SELECT p.p_promo_name, i.i_color, i.i_class, d.d_date AS dt, ss.ss_ext_sales_price AS rev, ss.ss_net_profit AS np
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  LEFT JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  WHERE d.d_date IN (SELECT dt FROM cur) OR d.d_date IN (SELECT dt FROM ly)),
pc AS (
  SELECT p_promo_name, i_color, SUM(np) AS np FROM f WHERE dt IN (SELECT dt FROM cur) GROUP BY ALL),
pt AS (
  SELECT p_promo_name, SUM(np) AS np FROM f WHERE dt IN (SELECT dt FROM cur) GROUP BY ALL),
k AS (
  SELECT p_promo_name, i_color, i_class,
    SUM(rev) FILTER (WHERE dt IN (SELECT dt FROM cur)) AS cur, SUM(rev) FILTER (WHERE dt IN (SELECT dt FROM ly)) AS ly
  FROM f GROUP BY ALL),
yoy AS (
  SELECT k.p_promo_name, k.i_color, AVG((COALESCE(k.cur, 0) - k.ly)::DOUBLE / NULLIF(k.ly, 0)) AS a
  FROM k JOIN (SELECT DISTINCT i_color, i_class FROM item) ic
    ON ic.i_color IS NOT DISTINCT FROM k.i_color AND ic.i_class IS NOT DISTINCT FROM k.i_class
  GROUP BY ALL),
t AS (
  SELECT g.p_promo_name, g.i_color, ABS(pc.np / NULLIF(pt.np, 0)) AS v, yoy.a
  FROM (SELECT * FROM (SELECT DISTINCT p_promo_name FROM promotion) p, (SELECT DISTINCT i_color FROM item) i) g
  LEFT JOIN pc ON pc.p_promo_name IS NOT DISTINCT FROM g.p_promo_name AND pc.i_color IS NOT DISTINCT FROM g.i_color
  LEFT JOIN pt ON pt.p_promo_name IS NOT DISTINCT FROM g.p_promo_name
  LEFT JOIN yoy ON yoy.p_promo_name IS NOT DISTINCT FROM g.p_promo_name AND yoy.i_color IS NOT DISTINCT FROM g.i_color)
SELECT p_promo_name, i_color, COALESCE(v * 2, 0) + COALESCE(a, 0) AS m0
FROM t WHERE v IS NOT NULL OR a IS NOT NULL
