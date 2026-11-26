-- m0 over the last year (YTD): with no item filter the profit share is 1 (or blank), never over 10:
-- the largest store quantity. RANKX of a MIN no ship mode row changes: 1. With no date filter a
-- year back is every year but the last.
WITH y AS (SELECT MAX(d_year) AS y FROM date_dim),
s AS (
  SELECT SUM(ss.ss_net_profit) FILTER (WHERE d.d_year = (SELECT y FROM y)) AS profit_ytd,
    MAX(ss.ss_quantity) FILTER (WHERE d.d_year = (SELECT y FROM y)) AS qty_ytd,
    SUM(ss.ss_ext_sales_price) AS rev,
    SUM(ss.ss_ext_sales_price) FILTER (WHERE d.d_year < (SELECT y FROM y)) AS ly
  FROM store_sales ss LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
), c AS (
  SELECT SUM(cs.cs_quantity) AS qty, SUM(cs.cs_quantity) FILTER (WHERE d.d_year < (SELECT y FROM y)) AS ly,
    COUNT(*) FILTER (WHERE d.d_year = (SELECT y FROM y)) AS rows_ytd
  FROM catalog_sales cs LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
), r AS (
  SELECT
    CASE WHEN s.profit_ytd / NULLIF(s.profit_ytd, 0) > 10 THEN NULLIF(c.rows_ytd, 0) ELSE s.qty_ytd END AS m0,
    COALESCE(((COALESCE(c.qty, 0) - c.ly) / NULLIF(c.ly, 0))
      / NULLIF((SELECT COUNT(DISTINCT i_class) + MAX(CASE WHEN i_class IS NULL THEN 1 ELSE 0 END) FROM item), 0), 0) - 1 AS m1,
    (COALESCE(rev, 0) - s.ly) / NULLIF(s.ly, 0) AS yoy
  FROM s CROSS JOIN c
), fiction AS (
  SELECT MIN(cs.cs_quantity) AS v FROM catalog_sales cs JOIN item i ON i.i_item_sk = cs.cs_item_sk AND i.i_class = 'fiction'
)
SELECT m0, m1, CASE WHEN yoy IS NULL AND fiction.v IS NULL THEN NULL ELSE COALESCE(yoy * 2, 0) + COALESCE(fiction.v, 0) END
FROM r CROSS JOIN fiction
