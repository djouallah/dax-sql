-- m0: the class is not in scope: the state's cities (MINX over the categories of a value no
-- category row changes). m2: the category filter keeps every category when the state has store
-- sales (COUNTROWS sees no category row); the catalog MIN is not filtered by the store.
WITH last_year AS (SELECT MAX(d_year) AS y FROM date_dim),
s AS (
  SELECT st.s_state AS state,
    SUM(ss.ss_ext_sales_price) FILTER (WHERE d.d_year < (SELECT y FROM last_year)) AS ly,
    SUM(ss.ss_net_profit) AS profit,
    SUM(ss.ss_ext_sales_price) FILTER (WHERE d.d_year = (SELECT y FROM last_year)) AS ytd,
    MIN(ss.ss_quantity) AS min_qty
  FROM store_sales ss
  LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY 1
), cities AS (
  SELECT s_state AS state, NULLIF(COUNT(DISTINCT s_city) + MAX(CASE WHEN s_city IS NULL THEN 1 ELSE 0 END), 0) AS n FROM store GROUP BY 1
), a AS (SELECT SUM(row_count) AS src FROM stg_tpcds_archive_log),
c AS (SELECT MIN(cs_net_profit) AS mn FROM catalog_sales),
g AS (SELECT DISTINCT s_state AS state FROM store),
r AS (
  SELECT g.state, ci.n AS m0,
    CASE WHEN a.src IS NULL AND s.ly IS NULL AND s.profit IS NULL THEN NULL
         ELSE COALESCE(a.src * 2, 0) + COALESCE(s.ly * 2, 0) + COALESCE(s.profit, 0) END / NULLIF(ABS(s.ytd), 0) AS m1,
    ROUND(c.mn / NULLIF(s.min_qty, 0), 4) AS m2
  FROM g
  LEFT JOIN s ON s.state IS NOT DISTINCT FROM g.state
  LEFT JOIN cities ci ON ci.state IS NOT DISTINCT FROM g.state
  CROSS JOIN a CROSS JOIN c
)
SELECT * FROM r WHERE m0 IS NOT NULL OR m1 IS NOT NULL OR m2 IS NOT NULL
