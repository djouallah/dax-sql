-- items of class pants or fiction, colour not khaki; per colour, price and month (every one: a rank is never blank):
-- m0 = dense rank (descending) of the store revenue YoY at this price among all the item prices, the classes held to
-- those of this colour and price (auto-exist: ALL(price) leaves the class x colour pairs); a price with no YoY is
-- blank, ranked as 0. Last year = each date of the month a year back (a month's last day also its month's).
-- m1, m2 = smallest store profit and catalog quantity
WITH f AS (
  SELECT * FROM item WHERE i_class IN ('pants', 'fiction') AND i_color IS DISTINCT FROM 'khaki'
), g AS (
  SELECT DISTINCT i_color, i_current_price FROM f
), k AS (
  SELECT DISTINCT i_color, i_current_price, i_class FROM f
), lym AS (
  SELECT DISTINCT x.d_moy, d.d_date_sk_1 AS sk
  FROM (SELECT d_moy, (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
        UNION SELECT d_moy, last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)) x
  JOIN date_dim d ON d.d_date = x.dt
), cur AS (
  SELECT i.i_color, i.i_class, i.i_current_price, d.d_moy, SUM(ss.ss_ext_sales_price) AS rev, MIN(ss.ss_net_profit) AS mnp
  FROM store_sales ss JOIN f i ON i.i_item_sk = ss.ss_item_sk JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
), ly AS (
  SELECT i.i_color, i.i_class, i.i_current_price, lym.d_moy, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss JOIN f i ON i.i_item_sk = ss.ss_item_sk JOIN lym ON lym.sk = ss.ss_sold_date_sk
  GROUP BY ALL
), yoy AS (
  -- per group (colour, price0) and price p: YoY over the items of the colour, the group's classes and price p
  SELECT k.i_color, k.i_current_price AS p0, ly.i_current_price AS p, ly.d_moy,
    (COALESCE(SUM(cur.rev), 0) - SUM(ly.rev)) / NULLIF(SUM(ly.rev), 0) AS v
  FROM k JOIN ly ON ly.i_color IS NOT DISTINCT FROM k.i_color AND ly.i_class = k.i_class
  LEFT JOIN cur ON cur.i_color IS NOT DISTINCT FROM ly.i_color AND cur.i_class = ly.i_class AND cur.i_current_price IS NOT DISTINCT FROM ly.i_current_price AND cur.d_moy = ly.d_moy
  GROUP BY ALL
), gm AS (
  SELECT g.i_color, g.i_current_price, m.d_moy FROM g CROSS JOIN (SELECT DISTINCT d_moy FROM date_dim) m
), vals AS (
  -- the distinct values ranked per group and month: the YoYs, and 0 when some price has none
  SELECT i_color, p0, d_moy, v FROM yoy WHERE v IS NOT NULL
  UNION
  SELECT gm.i_color, gm.i_current_price, gm.d_moy, 0 FROM gm
  WHERE (SELECT COUNT(DISTINCT i_current_price) + MAX(CASE WHEN i_current_price IS NULL THEN 1 ELSE 0 END) FROM item)
      > (SELECT COUNT(*) FROM yoy WHERE yoy.i_color IS NOT DISTINCT FROM gm.i_color AND yoy.p0 IS NOT DISTINCT FROM gm.i_current_price AND yoy.d_moy = gm.d_moy AND yoy.v IS NOT NULL)
), s AS (
  SELECT i_color, i_current_price, d_moy, MIN(mnp) AS mnp FROM cur GROUP BY ALL
), mq AS (
  SELECT i.i_color, i.i_current_price, d.d_moy, MIN(cs.cs_quantity) AS mq
  FROM catalog_sales cs JOIN f i ON i.i_item_sk = cs.cs_item_sk JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY ALL
)
SELECT gm.i_color, gm.d_moy, gm.i_current_price,
  1 + (SELECT COUNT(*) FROM vals WHERE vals.i_color IS NOT DISTINCT FROM gm.i_color AND vals.p0 IS NOT DISTINCT FROM gm.i_current_price AND vals.d_moy = gm.d_moy AND vals.v > COALESCE(y.v, 0)) AS m0,
  s.mnp AS m1, mq.mq AS m2
FROM gm
LEFT JOIN yoy y ON y.i_color IS NOT DISTINCT FROM gm.i_color AND y.p0 IS NOT DISTINCT FROM gm.i_current_price AND y.p IS NOT DISTINCT FROM gm.i_current_price AND y.d_moy = gm.d_moy
LEFT JOIN s ON s.i_color IS NOT DISTINCT FROM gm.i_color AND s.i_current_price IS NOT DISTINCT FROM gm.i_current_price AND s.d_moy = gm.d_moy
LEFT JOIN mq ON mq.i_color IS NOT DISTINCT FROM gm.i_color AND mq.i_current_price IS NOT DISTINCT FROM gm.i_current_price AND mq.d_moy = gm.d_moy
