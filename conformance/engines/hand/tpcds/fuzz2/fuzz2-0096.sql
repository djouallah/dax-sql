-- m1 (the same for every ship type): per category and quarter, the dense rank among all brands of each brand's
-- rank of its quarter among the quarters, both of the store revenue on the quarter's dates a year back (a blank
-- as 0; d_qoy need not follow calendar quarters). The outer value is that rank with no brand filter; a brand
-- with no sales in the category ranks 1, never above it. Every category x quarter is a group.
WITH a AS (
  SELECT d.d_date AS dt, i.i_category, i.i_brand, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  GROUP BY ALL),
q AS (SELECT d_qoy, d_date AS dt, (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim),
qly AS (SELECT d_qoy, ly FROM q UNION SELECT d_qoy, last_day(ly) FROM q WHERE dt = last_day(dt)),
qs AS (SELECT DISTINCT d_qoy FROM date_dim),
sb0 AS (
  SELECT a.i_category, a.i_brand, qly.d_qoy, SUM(a.rev) AS v FROM qly JOIN a ON a.dt = qly.ly GROUP BY ALL),
sb AS (
  SELECT cb.i_category, cb.i_brand, qs.d_qoy, COALESCE(sb0.v, 0) AS v
  FROM (SELECT DISTINCT i_category, i_brand FROM sb0) cb CROSS JOIN qs
  LEFT JOIN sb0 ON sb0.i_category IS NOT DISTINCT FROM cb.i_category AND sb0.i_brand IS NOT DISTINCT FROM cb.i_brand
    AND sb0.d_qoy = qs.d_qoy),
sc AS (SELECT i_category, d_qoy, SUM(v) AS v FROM sb GROUP BY ALL),
inner_rk AS (
  SELECT x.i_category, x.i_brand, x.d_qoy, 1 + COUNT(DISTINCT y.v) FILTER (WHERE y.v > x.v) AS r
  FROM sb x JOIN sb y ON y.i_category IS NOT DISTINCT FROM x.i_category AND y.i_brand IS NOT DISTINCT FROM x.i_brand
  GROUP BY ALL),
val AS (
  SELECT x.i_category, x.d_qoy, 1 + COUNT(DISTINCT y.v) FILTER (WHERE y.v > x.v) AS r
  FROM sc x JOIN sc y ON y.i_category IS NOT DISTINCT FROM x.i_category
  GROUP BY ALL),
outer_rk AS (
  SELECT val.i_category, val.d_qoy, 1 + COUNT(DISTINCT ir.r) FILTER (WHERE ir.r > val.r) AS r
  FROM val LEFT JOIN inner_rk ir ON ir.i_category IS NOT DISTINCT FROM val.i_category AND ir.d_qoy = val.d_qoy
  GROUP BY ALL),
c AS (
  SELECT i.i_category, d.d_qoy, SUM(cs.cs_ext_sales_price) AS rev
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL)
SELECT g.i_category, g.d_qoy, c.rev AS m0,
  CASE WHEN EXISTS (SELECT 1 FROM ship_mode) THEN COALESCE(o.r, 1)::DOUBLE END AS m1
FROM (SELECT DISTINCT i.i_category, qs.d_qoy FROM item i, qs) g
LEFT JOIN c ON c.i_category IS NOT DISTINCT FROM g.i_category AND c.d_qoy = g.d_qoy
LEFT JOIN outer_rk o ON o.i_category IS NOT DISTINCT FROM g.i_category AND o.d_qoy = g.d_qoy
