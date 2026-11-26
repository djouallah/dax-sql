-- stores of Fairview, Midway and Oak Grove; per item color and category: m0, the ship mode types whose catalog
-- revenue less the store profit share of the color and category (over every item's) is above 1000;
-- m1, the states of those stores whose store revenue YoY (every date a year back) is above 100
WITH shift AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), st AS (
  SELECT * FROM store WHERE s_city IN ('Fairview', 'Midway', 'Oak Grove')
), s AS (
  SELECT i.i_color, i.i_category, st.s_state, SUM(ss.ss_net_profit) AS profit, SUM(ss.ss_ext_sales_price) AS rev,
    SUM(ss.ss_ext_sales_price) FILTER (WHERE d.d_date IN (SELECT ly FROM shift)) AS rev_ly
  FROM store_sales ss JOIN st ON st.s_store_sk = ss.ss_store_sk
  JOIN item i ON i.i_item_sk = ss.ss_item_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
), share AS (
  SELECT i_color, i_category, SUM(profit) / NULLIF((SELECT SUM(profit) FROM s), 0) AS share FROM s GROUP BY ALL
), c AS (
  SELECT i.i_color, i.i_category, sm.sm_type, SUM(cs.cs_ext_sales_price) AS rev
  FROM catalog_sales cs JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk
  JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
), g AS (
  SELECT DISTINCT i_color, i_category FROM item
), m0 AS (
  SELECT g.i_color, g.i_category, NULLIF(COUNT(*), 0) AS n
  FROM g CROSS JOIN (SELECT DISTINCT sm_type FROM ship_mode) t
  LEFT JOIN c ON c.i_color IS NOT DISTINCT FROM g.i_color AND c.i_category IS NOT DISTINCT FROM g.i_category AND c.sm_type IS NOT DISTINCT FROM t.sm_type
  LEFT JOIN share sh ON sh.i_color IS NOT DISTINCT FROM g.i_color AND sh.i_category IS NOT DISTINCT FROM g.i_category
  WHERE COALESCE(c.rev, 0) - COALESCE(sh.share, 0) > 1000
  GROUP BY ALL
), m1 AS (
  SELECT i_color, i_category, NULLIF(COUNT(*), 0) AS n
  FROM s WHERE (COALESCE(rev, 0) - rev_ly) / NULLIF(rev_ly, 0) > 100
  GROUP BY ALL
)
SELECT g.i_color, g.i_category, m0.n AS m0, m1.n AS m1
FROM g
LEFT JOIN m0 ON m0.i_color IS NOT DISTINCT FROM g.i_color AND m0.i_category IS NOT DISTINCT FROM g.i_category
LEFT JOIN m1 ON m1.i_color IS NOT DISTINCT FROM g.i_color AND m1.i_category IS NOT DISTINCT FROM g.i_category
WHERE m0.n IS NOT NULL OR m1.n IS NOT NULL
