-- YTD with no date filter: the last year, whole; a year back from it: the year before, whole
WITH y AS (SELECT MAX(d_year) AS y FROM date_dim),
c AS (
  SELECT i.i_category AS k,
    SUM(cs.cs_quantity) FILTER (WHERE d.d_year = (SELECT y FROM y)) AS qty,
    SUM(cs.cs_quantity) FILTER (WHERE d.d_year = (SELECT y FROM y) - 1) AS ly
  FROM catalog_sales cs
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY 1
)
SELECT k, (COALESCE(qty, 0) - ly) / NULLIF(ly, 0) AS v FROM c WHERE (COALESCE(qty, 0) - ly) / NULLIF(ly, 0) IS NOT NULL
