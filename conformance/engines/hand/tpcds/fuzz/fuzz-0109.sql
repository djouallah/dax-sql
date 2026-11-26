-- m1 is never blank (the archive rows less the YoY): every brand and class pair of the item table.
-- With no date filter, a year back is every year but the last.
WITH y AS (SELECT MAX(d_year) AS y FROM date_dim),
s AS (
  SELECT i.i_brand AS b, i.i_class AS c, SUM(ss.ss_ext_sales_price) AS v
  FROM store_sales ss
  JOIN item i ON i.i_item_sk = ss.ss_item_sk
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_year < (SELECT y FROM y)
  GROUP BY 1, 2
), c AS (
  SELECT i.i_brand AS b, i.i_class AS c, SUM(cs.cs_quantity) AS qty,
    SUM(cs.cs_quantity) FILTER (WHERE d.d_year < (SELECT y FROM y)) AS ly
  FROM catalog_sales cs
  JOIN item i ON i.i_item_sk = cs.cs_item_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY 1, 2
), a AS (SELECT NULLIF(COUNT(*), 0) AS n FROM stg_tpcds_archive_log),
r AS (
  SELECT g.b, g.c, s.v AS m0,
    CASE WHEN a.n IS NULL AND (COALESCE(c.qty, 0) - c.ly) / NULLIF(c.ly, 0) IS NULL THEN NULL
         ELSE COALESCE(a.n, 0) - COALESCE((COALESCE(c.qty, 0) - c.ly) / NULLIF(c.ly, 0), 0) END AS m1
  FROM (SELECT DISTINCT i_brand AS b, i_class AS c FROM item) g
  CROSS JOIN a
  LEFT JOIN s ON s.b IS NOT DISTINCT FROM g.b AND s.c IS NOT DISTINCT FROM g.c
  LEFT JOIN c ON c.b IS NOT DISTINCT FROM g.b AND c.c IS NOT DISTINCT FROM g.c
)
SELECT * FROM r WHERE m0 IS NOT NULL OR m1 IS NOT NULL
