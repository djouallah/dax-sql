-- m0: MIN (no context transition) is the same for every city: the rank is 1, so every promotion name x
-- (category, brand) of item is a group. m1: the least of the years' store row counts (a year's YTD is the year).
WITH y AS (
  SELECT p.p_promo_name, i.i_category, i.i_brand, d.d_year, COUNT(*) AS n
  FROM store_sales ss LEFT JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL),
m AS (SELECT p_promo_name, i_category, i_brand, MIN(n) AS n FROM y GROUP BY ALL)
SELECT g.p_promo_name, g.i_category, g.i_brand, 1 AS m0, m.n AS m1
FROM (SELECT * FROM (SELECT DISTINCT p_promo_name FROM promotion) p, (SELECT DISTINCT i_category, i_brand FROM item) i) g
LEFT JOIN m ON m.p_promo_name IS NOT DISTINCT FROM g.p_promo_name AND m.i_category IS NOT DISTINCT FROM g.i_category
  AND m.i_brand IS NOT DISTINCT FROM g.i_brand
