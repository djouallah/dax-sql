-- no grouping, no filter: every date, and every date a year back for the LY measures
--   m0: store revenue a year back, of the items of the second color by descending color
--   m1: catalog YoY if the largest catalog profit is past 0 and there is a quantity a year back,
--       else store revenue a year back
--   m2: the first 6 characters of the years joined: their length
WITH ly AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), color2 AS (
  SELECT i_color FROM (SELECT DISTINCT i_color FROM item) ORDER BY i_color DESC NULLS LAST LIMIT 1 OFFSET 1
), s AS (
  SELECT SUM(ss.ss_ext_sales_price) AS rev_ly,
         SUM(ss.ss_ext_sales_price) FILTER (WHERE i.i_color IS NOT DISTINCT FROM (SELECT i_color FROM color2) AND EXISTS (SELECT 1 FROM color2)) AS rev_ly_color2
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk JOIN ly ON ly.dt = d.d_date
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
), c AS (
  SELECT MAX(cs.cs_net_profit) AS np_max, SUM(cs.cs_quantity) AS qty,
         SUM(cs.cs_quantity) FILTER (WHERE ly.dt IS NOT NULL) AS qty_ly
  FROM catalog_sales cs LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk LEFT JOIN ly ON ly.dt = d.d_date
)
SELECT s.rev_ly_color2 AS m0,
       CASE WHEN c.np_max > 0 AND c.qty_ly IS NOT NULL THEN (COALESCE(c.qty, 0) - c.qty_ly) / NULLIF(c.qty_ly, 0) ELSE s.rev_ly END AS m1,
       (SELECT length(left(upper(COALESCE(string_agg(d_year::VARCHAR, '|' ORDER BY d_year NULLS FIRST), '')), 6)) FROM (SELECT DISTINCT d_year FROM date_dim)) AS m2
FROM s CROSS JOIN c
