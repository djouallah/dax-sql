-- under i_category >= "Home". Not in scope of the price: v is the catalog revenue. With no date
-- filter a year back is every year but the last; the YTD is the last year. Catalog sales of no ship mode
-- are ship_mode's blank row (a blank type), sales of no store store's (a blank state).
WITH last_year AS (SELECT MAX(d_year) AS y FROM date_dim),
cat AS (
  SELECT sm.sm_type AS s, SUM(cs.cs_ext_sales_price) AS v,
    AVG(cs.cs_quantity) FILTER (WHERE d.d_date BETWEEN DATE '2024-08-20' AND DATE '2026-03-16') AS aq
  FROM catalog_sales cs
  JOIN item i ON i.i_item_sk = cs.cs_item_sk AND i.i_category >= 'Home'
  LEFT JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY 1
), st AS (
  SELECT SUM(ss.ss_ext_sales_price) AS rev,
    SUM(ss.ss_ext_sales_price) FILTER (WHERE d.d_year < (SELECT y FROM last_year)) AS ly
  FROM store_sales ss
  JOIN item i ON i.i_item_sk = ss.ss_item_sk AND i.i_category >= 'Home'
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
), yoy AS (SELECT rev, (COALESCE(rev, 0) - ly) / NULLIF(ly, 0) AS v FROM st),
states AS (
  SELECT NULLIF(COUNT(*), 0) AS n FROM (
    SELECT s.s_state
    FROM (SELECT DISTINCT s_state FROM store UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store))) s
    JOIN (
      SELECT st.s_state, MIN(ss.ss_ext_sales_price) AS mn
      FROM store_sales ss
      JOIN item i ON i.i_item_sk = ss.ss_item_sk AND i.i_category >= 'Home'
      LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
      GROUP BY 1
    ) m ON m.s_state IS NOT DISTINCT FROM s.s_state
    WHERE m.mn > 100)
), ytd AS (
  SELECT SUM(ss.ss_ext_sales_price) AS v
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  WHERE d.d_year = (SELECT y FROM last_year)
), g AS (
  SELECT DISTINCT sm_type AS s FROM ship_mode
  UNION
  SELECT NULL WHERE EXISTS (SELECT 1 FROM catalog_sales WHERE cs_ship_mode_sk IS NULL
                              OR cs_ship_mode_sk NOT IN (SELECT sm_ship_mode_sk FROM ship_mode))
),
r AS (
  SELECT g.s,
    -- a fixed decimal over a number: a fixed decimal
    ROUND(CASE WHEN cat.v IS NULL AND yoy.rev IS NULL THEN NULL ELSE COALESCE(cat.v * 2, 0) + COALESCE(ROUND(yoy.rev, 0), 0) END
      / NULLIF(cat.aq / NULLIF(yoy.v, 0), 0), 4) AS m0,
    states.n / NULLIF(ytd.v, 0) AS m1
  FROM g
  LEFT JOIN cat ON cat.s IS NOT DISTINCT FROM g.s
  CROSS JOIN yoy CROSS JOIN states CROSS JOIN ytd
)
SELECT * FROM r WHERE m0 IS NOT NULL OR m1 IS NOT NULL
