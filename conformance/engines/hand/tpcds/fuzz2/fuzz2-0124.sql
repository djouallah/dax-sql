-- per category and year (a year a year back is the year before, whole). m0: the largest catalog sale when catalog
-- profit is over 1000, else catalog quantity YoY. m1: the average store sale of the cities whose revenue the year
-- before is over 0
WITH c AS (
  SELECT i.i_category, d.d_year, SUM(cs.cs_net_profit) AS np, MAX(cs.cs_ext_sales_price) AS mx, SUM(cs.cs_quantity) AS q
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
), s AS (
  SELECT i.i_category, d.d_year, st.s_city, SUM(ss.ss_ext_sales_price) AS rev, COUNT(ss.ss_ext_sales_price) AS n
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
  GROUP BY ALL
), m1 AS (
  SELECT s.i_category, s.d_year, ROUND(SUM(s.rev) / SUM(s.n), 4) AS m1
  FROM s JOIN s l ON l.i_category IS NOT DISTINCT FROM s.i_category AND l.d_year = s.d_year - 1 AND l.s_city = s.s_city AND l.rev > 0
  WHERE s.s_city IN (SELECT s_city FROM store)
  GROUP BY ALL
)
SELECT k.i_category, y.d_year,
  CASE WHEN COALESCE(c.np, 0) > 1000 THEN c.mx ELSE (COALESCE(c.q, 0) - l.q) / NULLIF(l.q, 0) END AS m0,
  m1.m1
FROM (SELECT DISTINCT i_category FROM item) k CROSS JOIN (SELECT DISTINCT d_year FROM date_dim) y
LEFT JOIN c ON c.i_category IS NOT DISTINCT FROM k.i_category AND c.d_year = y.d_year
LEFT JOIN c l ON l.i_category IS NOT DISTINCT FROM k.i_category AND l.d_year = y.d_year - 1
LEFT JOIN m1 ON m1.i_category IS NOT DISTINCT FROM k.i_category AND m1.d_year = y.d_year
WHERE m0 IS NOT NULL OR m1.m1 IS NOT NULL
