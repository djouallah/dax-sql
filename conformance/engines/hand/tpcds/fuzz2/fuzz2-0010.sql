-- items not of class accessories, per store city and item color:
-- m0: the dense rank, among the promotions, of store revenue a year back over every promotion
-- m1: store revenue a year back / the color's items (of those classes; an item with no class is kept, blank <> "accessories")
-- no date filter: "a year back" is every date whose next-year date is in the calendar
WITH ly AS (
  SELECT d_date_sk_1 FROM date_dim WHERE CAST(d_date + INTERVAL 1 YEAR AS DATE) IN (SELECT d_date FROM date_dim)
), it AS (
  SELECT * FROM item WHERE COALESCE(i_class, '') <> 'accessories'
), rev AS (
  SELECT s.s_city, i.i_color, p.p_promo_name, GROUPING(p.p_promo_name) AS allp, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss
  JOIN ly ON ly.d_date_sk_1 = ss.ss_sold_date_sk
  JOIN it i ON i.i_item_sk = ss.ss_item_sk
  JOIN store s ON s.s_store_sk = ss.ss_store_sk
  LEFT JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk
  GROUP BY GROUPING SETS ((s.s_city, i.i_color, p.p_promo_name), (s.s_city, i.i_color))
), g AS (
  SELECT c.s_city, k.i_color, k.n
  FROM (SELECT DISTINCT s_city FROM store) c
  CROSS JOIN (SELECT i_color, COUNT(*) AS n FROM it GROUP BY ALL) k
)
SELECT g.s_city, g.i_color,
  1 + (SELECT COUNT(DISTINCT COALESCE(r.rev, 0))
       FROM (SELECT DISTINCT p_promo_name FROM promotion) p
       LEFT JOIN rev r ON r.allp = 0 AND r.p_promo_name = p.p_promo_name AND r.s_city IS NOT DISTINCT FROM g.s_city AND r.i_color IS NOT DISTINCT FROM g.i_color
       WHERE COALESCE(r.rev, 0) > COALESCE(t.rev, 0)) AS m0,
  ROUND(t.rev / g.n, 4) AS m1 -- currency / integer: a fixed decimal
FROM g
LEFT JOIN rev t ON t.allp = 1 AND t.s_city IS NOT DISTINCT FROM g.s_city AND t.i_color IS NOT DISTINCT FROM g.i_color
