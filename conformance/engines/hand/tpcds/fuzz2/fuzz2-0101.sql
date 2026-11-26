-- per brand and year: catalog rows over (catalog quantity YoY, the year before as a whole + the brand's share of the
-- year's store profit / the store count); m1: d_qoy never has one value in a year (blank); m2: the brand's share of
-- Texas stores' profit, all dates. A sale with no (or an unknown) date makes the date table's blank row: a blank
-- year (no year before it), holding those sales
WITH c AS (
  SELECT i.i_brand, d.d_year, COUNT(*) AS n, SUM(cs.cs_quantity) AS q
  FROM catalog_sales cs JOIN item i ON i.i_item_sk = cs.cs_item_sk LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY ALL
), s AS (
  SELECT i.i_brand, d.d_year, SUM(ss.ss_net_profit) AS np
  FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
), sy AS (
  SELECT d_year, SUM(np) AS np FROM s GROUP BY ALL
), tx AS (
  SELECT i.i_brand, SUM(ss.ss_net_profit) AS np
  FROM store_sales ss JOIN store st ON st.s_store_sk = ss.ss_store_sk AND st.s_state = 'TX'
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  GROUP BY ALL
), txall AS (
  SELECT SUM(np) AS np FROM tx
), g AS (
  SELECT b.i_brand, y.d_year, c.n,
    (COALESCE(c.q, 0) - l.q) / NULLIF(l.q, 0) AS yoy,
    s.np / NULLIF(sy.np, 0) / (SELECT COUNT(*) FROM store) AS sp,
    COALESCE(ROUND(tx.np / NULLIF((SELECT np FROM txall), 0), 1), 0) AS m2
  FROM (SELECT DISTINCT i_brand FROM item) b
  CROSS JOIN (SELECT DISTINCT d_year FROM date_dim
    UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_sold_date_sk IS NULL OR ss_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
      OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_sold_date_sk IS NULL OR cs_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))) y
  LEFT JOIN c ON c.i_brand IS NOT DISTINCT FROM b.i_brand AND c.d_year IS NOT DISTINCT FROM y.d_year
  LEFT JOIN c l ON l.i_brand IS NOT DISTINCT FROM b.i_brand AND l.d_year = y.d_year - 1
  LEFT JOIN s ON s.i_brand IS NOT DISTINCT FROM b.i_brand AND s.d_year IS NOT DISTINCT FROM y.d_year
  LEFT JOIN sy ON sy.d_year IS NOT DISTINCT FROM y.d_year
  LEFT JOIN tx ON tx.i_brand IS NOT DISTINCT FROM b.i_brand
)
SELECT i_brand, d_year,
  n / NULLIF(CASE WHEN yoy IS NULL AND sp IS NULL THEN NULL ELSE COALESCE(yoy, 0) + COALESCE(sp, 0) END, 0) AS m0,
  NULL::DOUBLE AS m1, m2
FROM g
