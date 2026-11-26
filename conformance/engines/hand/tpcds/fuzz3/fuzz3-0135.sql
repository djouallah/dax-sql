-- one row under the states other than TX and the two promotions. m0: SELECTEDVALUE of the year
-- over the whole calendar is blank, not 2024; the stores do not reach catalog_sales. m1: TOTALYTD
-- over every date, the last year. m2: the items not "snow" (a blank color is not "snow")
WITH s AS (
  SELECT AVG(ss.ss_quantity) AS av, MAX(ss.ss_quantity) AS mx,
    COUNT(DISTINCT i.i_current_price) + MAX((i.i_current_price IS NULL)::INT) AS dp
  FROM store_sales ss
  JOIN store st ON st.s_store_sk = ss.ss_store_sk AND st.s_state <> 'TX'
  JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk AND p.p_promo_name IN ('cally', 'pri')
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
), c AS (
  SELECT SUM(cs.cs_ext_sales_price) AS rev,
    ROUND((SUM(cs.cs_ext_sales_price) FILTER (WHERE d.d_year = (SELECT year(MAX(d_date)) FROM date_dim)) * 1000000)::HUGEINT
      // NULLIF(COUNT(cs.cs_ext_sales_price) FILTER (WHERE d.d_year = (SELECT year(MAX(d_date)) FROM date_dim)), 0) * 0.000001, 4) AS av
  FROM catalog_sales cs
  JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk AND p.p_promo_name IN ('cally', 'pri')
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
), y AS (SELECT CASE WHEN COUNT(DISTINCT d_year) = 1 THEN MIN(d_year) END AS y FROM date_dim),
t AS (
  SELECT c.rev, s.av * 2 AS v2, CASE WHEN COALESCE(y.y, 0) = 2024 THEN NULLIF(s.dp, 0) ELSE s.mx END AS x, c.av
  FROM s, c, y
)
SELECT CASE WHEN rev IS NULL AND v2 IS NULL AND x IS NULL THEN NULL ELSE COALESCE(rev, 0) + COALESCE(v2, 0) + COALESCE(x, 0) END AS m0,
  COALESCE(av, 0) AS m1,
  (SELECT NULLIF(COUNT(DISTINCT i_brand) + MAX((i_brand IS NULL)::INT), 0) FROM item WHERE COALESCE(i_color, '') <> 'snow') AS m2
FROM t
