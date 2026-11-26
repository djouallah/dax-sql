-- m0: over the colors, catalog quantity a year back (every date shifted) of brand importcorp #7,
--     absolute, averaged (blanks skipped)
-- m1: catalog YoY, all sales against every date a year back
-- m2: the first 4 characters of the states joined: their length (a blank state first when sales of no
--     store give store a blank row)
WITH ly AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), c AS (
  SELECT SUM(cs.cs_quantity) AS qty, SUM(cs.cs_quantity) FILTER (WHERE ly.dt IS NOT NULL) AS qty_ly
  FROM catalog_sales cs LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk LEFT JOIN ly ON ly.dt = d.d_date
), b AS (
  SELECT i.i_color, abs(SUM(cs.cs_quantity)) AS qty
  FROM catalog_sales cs JOIN item i ON i.i_item_sk = cs.cs_item_sk AND i.i_brand = 'importcorp #7'
  JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk JOIN ly ON ly.dt = d.d_date
  GROUP BY ALL
)
SELECT (SELECT AVG(qty) FROM b) AS m0,
       (COALESCE(c.qty, 0) - c.qty_ly) / NULLIF(c.qty_ly, 0) AS m1,
       (SELECT length(left(upper(COALESCE(string_agg(COALESCE(s_state, ''), '|' ORDER BY s_state NULLS FIRST), '')), 4)) FROM (SELECT DISTINCT s_state FROM store UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store)))) AS m2
FROM c
