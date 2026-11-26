-- [Archive Files] is the same for every group, so every city x class x year is a group.
-- m0: neither ship_mode nor price is grouped; Archive Files > 0 picks the catalog quantity.
-- m2: the store profit share (of the city's and year's profit over all items) less the class's count of
-- Sports items; past 10, the year's (YTD of a whole year) IF; else the catalog average over a dense rank
-- that is 1 (the total over all promotions is never below one promotion's revenue).
WITH arch AS (SELECT NULLIF(COUNT(*), 0) AS n FROM stg_tpcds_archive_log),
g AS (
  SELECT c.s_city, k.i_class, y.d_year
  FROM (SELECT DISTINCT s_city FROM store) c, (SELECT DISTINCT i_class FROM item) k, (SELECT DISTINCT d_year FROM date_dim) y),
c AS (
  SELECT i.i_class, d.d_year, SUM(cs.cs_quantity) AS q, COUNT(*) AS n, (ROUND(AVG(cs.cs_ext_sales_price) * 10000, 0) / 10000) AS a
  FROM catalog_sales cs LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY ALL),
s AS (
  SELECT st.s_city, i.i_class, d.d_year, SUM(ss.ss_net_profit) AS p, (ROUND(AVG(ss.ss_ext_sales_price) * 10000, 0) / 10000) AS a, MIN(ss.ss_net_profit) AS mn
  FROM store_sales ss LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL),
sy AS (SELECT s_city, d_year, SUM(p) AS p FROM s GROUP BY ALL),
sports AS (SELECT DISTINCT i_class, 1 AS n FROM item WHERE i_category = 'Sports')
SELECT g.s_city, g.i_class, g.d_year,
  CASE WHEN arch.n > 0 THEN c.q ELSE c.n END AS m0,
  arch.n AS m1,
  CASE WHEN COALESCE(s.p / NULLIF(sy.p, 0), 0) - COALESCE(sports.n, 0) > 10
    THEN CASE WHEN COALESCE(s.a, 0) > 1000 THEN s.mn ELSE c.n END
    ELSE c.a END AS m2
FROM g CROSS JOIN arch
LEFT JOIN c ON c.i_class IS NOT DISTINCT FROM g.i_class AND c.d_year = g.d_year
LEFT JOIN s ON s.s_city IS NOT DISTINCT FROM g.s_city AND s.i_class IS NOT DISTINCT FROM g.i_class AND s.d_year = g.d_year
LEFT JOIN sy ON sy.s_city IS NOT DISTINCT FROM g.s_city AND sy.d_year = g.d_year
LEFT JOIN sports ON sports.i_class IS NOT DISTINCT FROM g.i_class
WHERE m0 IS NOT NULL OR m1 IS NOT NULL OR m2 IS NOT NULL
