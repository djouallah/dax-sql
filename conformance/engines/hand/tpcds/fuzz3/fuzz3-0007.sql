-- per existing item class/color/category:
--   m0: TOTALYTD(COUNTROWS(store)) is the stores (no date filters them), twice, plus the profit
--       share over itself with ALL(ca_state) (no state filter: the same share): 1 unless blank or 0
--   m1: the least store quantity
--   m2: catalog quantity over the education statuses whose store revenue YoY (all dates against
--       all dates a year back) is past 1000
WITH ly AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), g AS (
  SELECT DISTINCT i_class, i_color, i_category FROM item
), ss AS (
  SELECT i.i_class, i.i_color, i.i_category, SUM(ss.ss_net_profit) AS np, MIN(ss.ss_quantity) AS qmin
  FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk
  GROUP BY ALL
), yoy AS (
  SELECT i.i_class, i.i_color, i.i_category, cd.cd_education_status,
         SUM(ss.ss_ext_sales_price) AS rev, SUM(ss.ss_ext_sales_price) FILTER (WHERE ly.dt IS NOT NULL) AS rev_ly
  FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk
  JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk LEFT JOIN ly ON ly.dt = d.d_date
  GROUP BY ALL
), n AS (
  SELECT i_class, i_color, i_category, COUNT(*) AS n
  FROM yoy WHERE (rev - rev_ly) / NULLIF(rev_ly, 0) > 1000
  GROUP BY ALL
), cs AS (
  SELECT i.i_class, i.i_color, i.i_category, SUM(cs.cs_quantity) AS qty
  FROM catalog_sales cs JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
), tot AS (
  SELECT (SELECT COUNT(*) FROM store) AS stores, (SELECT SUM(ss_net_profit) FROM store_sales) AS np_all
)
SELECT g.i_class, g.i_color, g.i_category,
       2 * tot.stores + COALESCE(CASE WHEN ss.np <> 0 AND tot.np_all <> 0 THEN 1 END, 0) AS m0,
       ss.qmin AS m1,
       cs.qty / n.n AS m2
FROM g CROSS JOIN tot
LEFT JOIN ss ON ss.i_class IS NOT DISTINCT FROM g.i_class AND ss.i_color IS NOT DISTINCT FROM g.i_color AND ss.i_category IS NOT DISTINCT FROM g.i_category
LEFT JOIN cs ON cs.i_class IS NOT DISTINCT FROM g.i_class AND cs.i_color IS NOT DISTINCT FROM g.i_color AND cs.i_category IS NOT DISTINCT FROM g.i_category
LEFT JOIN n ON n.i_class IS NOT DISTINCT FROM g.i_class AND n.i_color IS NOT DISTINCT FROM g.i_color AND n.i_category IS NOT DISTINCT FROM g.i_category
