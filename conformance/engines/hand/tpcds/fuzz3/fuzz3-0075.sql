-- per category and price (the item's combinations), quarter 1, OVERNIGHT: more than one store, so twice the
-- store's distinct customers (a missing customer counts as one) plus, when the items' one color is khaki,
-- last year's store revenue (the dates a year back), else the catalog's largest sale
WITH g AS (
  SELECT i_category, i_current_price, bool_and(COALESCE(i_color = 'khaki', false)) AS khaki
  FROM item GROUP BY ALL
), s AS (
  SELECT i.i_category, i.i_current_price,
    COUNT(DISTINCT ss.ss_customer_sk) + (COUNT(*) > COUNT(ss.ss_customer_sk))::INT AS dc
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_qoy = 1
  JOIN item i ON i.i_item_sk = ss.ss_item_sk
  GROUP BY ALL
), ly AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim WHERE d_qoy = 1
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_qoy = 1 AND d_date = last_day(d_date)
), l AS (
  SELECT i.i_category, i.i_current_price, SUM(ss.ss_ext_sales_price) AS sply
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_date IN (SELECT dt FROM ly)
  JOIN item i ON i.i_item_sk = ss.ss_item_sk
  GROUP BY ALL
), c AS (
  SELECT i.i_category, i.i_current_price, MAX(cs.cs_ext_sales_price) AS mx
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk AND d.d_qoy = 1
  JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk AND sm.sm_type IN ('zz-none', 'OVERNIGHT')
  JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
), t AS (
  SELECT g.i_category, g.i_current_price, s.dc, CASE WHEN g.khaki THEN l.sply ELSE c.mx END AS x
  FROM g
  LEFT JOIN s ON s.i_category IS NOT DISTINCT FROM g.i_category AND s.i_current_price IS NOT DISTINCT FROM g.i_current_price
  LEFT JOIN l ON l.i_category IS NOT DISTINCT FROM g.i_category AND l.i_current_price IS NOT DISTINCT FROM g.i_current_price
  LEFT JOIN c ON c.i_category IS NOT DISTINCT FROM g.i_category AND c.i_current_price IS NOT DISTINCT FROM g.i_current_price
)
SELECT i_category, i_current_price, COALESCE(dc, 0) * 2 + COALESCE(x, 0) AS m0
FROM t WHERE dc IS NOT NULL OR x IS NOT NULL
