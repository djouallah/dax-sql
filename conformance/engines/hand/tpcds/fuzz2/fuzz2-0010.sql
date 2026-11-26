-- items not of class accessories, per store city and item color:
-- m0: the dense rank, among the promotions, of store revenue a year back over every promotion
-- m1: store revenue a year back / the color's items (of those classes; an item with no class is kept, blank <> "accessories")
-- no date filter: "a year back" is every date whose next-year date is in the calendar.
-- Blank rows: a sale with no or an unknown store, item or promotion is under the blank city, color or
-- promotion (blank <> "accessories" keeps the blank item); the blank color counts no item
WITH ly AS (
  SELECT d_date_sk_1 FROM date_dim WHERE CAST(d_date + INTERVAL 1 YEAR AS DATE) IN (SELECT d_date FROM date_dim)
), promo_blank AS (
  SELECT EXISTS (SELECT 1 FROM store_sales WHERE ss_promo_sk IS NULL OR ss_promo_sk NOT IN (SELECT p_promo_sk FROM promotion))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_promo_sk IS NULL OR cs_promo_sk NOT IN (SELECT p_promo_sk FROM promotion)) AS b
), item_blank AS (
  SELECT (SELECT b FROM promo_blank)
    OR EXISTS (SELECT 1 FROM store_sales WHERE ss_item_sk IS NULL OR ss_item_sk NOT IN (SELECT i_item_sk FROM item))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_item_sk IS NULL OR cs_item_sk NOT IN (SELECT i_item_sk FROM item))
    OR EXISTS (SELECT 1 FROM promotion WHERE p_item_sk IS NULL OR p_item_sk NOT IN (SELECT i_item_sk FROM item)) AS b
), it AS (
  SELECT * FROM item WHERE COALESCE(i_class, '') <> 'accessories'
), rev AS (
  SELECT s.s_city, i.i_color, p.p_promo_name, GROUPING(p.p_promo_name) AS allp, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss
  JOIN ly ON ly.d_date_sk_1 = ss.ss_sold_date_sk
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  LEFT JOIN store s ON s.s_store_sk = ss.ss_store_sk
  LEFT JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk
  WHERE COALESCE(i.i_class, '') <> 'accessories'
  GROUP BY GROUPING SETS ((s.s_city, i.i_color, p.p_promo_name), (s.s_city, i.i_color))
), promos AS (
  SELECT DISTINCT p_promo_name FROM promotion UNION SELECT NULL FROM promo_blank WHERE b
), g AS (
  SELECT c.s_city, k.i_color, n.n
  FROM (SELECT DISTINCT s_city FROM store
        UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store))) c
  CROSS JOIN (SELECT DISTINCT i_color FROM it UNION SELECT NULL FROM item_blank WHERE b) k
  LEFT JOIN (SELECT i_color, COUNT(*) AS n FROM it GROUP BY ALL) n ON n.i_color IS NOT DISTINCT FROM k.i_color
)
SELECT g.s_city, g.i_color,
  1 + (SELECT COUNT(DISTINCT COALESCE(r.rev, 0))
       FROM promos p
       LEFT JOIN rev r ON r.allp = 0 AND r.p_promo_name IS NOT DISTINCT FROM p.p_promo_name AND r.s_city IS NOT DISTINCT FROM g.s_city AND r.i_color IS NOT DISTINCT FROM g.i_color
       WHERE COALESCE(r.rev, 0) > COALESCE(t.rev, 0)) AS m0,
  ROUND(t.rev * 10000 / g.n, 0) / 10000 AS m1 -- currency / integer: a fixed decimal (ten-thousandths, half away from zero)
FROM g
LEFT JOIN rev t ON t.allp = 1 AND t.s_city IS NOT DISTINCT FROM g.s_city AND t.i_color IS NOT DISTINCT FROM g.i_color
