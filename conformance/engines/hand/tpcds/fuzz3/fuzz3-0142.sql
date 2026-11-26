-- the item columns' combinations that have a sale; MAX(a, b) of two scalars
WITH s AS (
  SELECT ss_item_sk AS k, MIN(ss_quantity) AS mn, MAX(ss_ext_sales_price) AS mx FROM store_sales GROUP BY 1
), c AS (
  SELECT cs_item_sk AS k, SUM(cs_ext_sales_price) AS r FROM catalog_sales GROUP BY 1
), t AS (
  SELECT i.i_color, i.i_category, i.i_brand, MIN(s.mn) AS mn, MAX(s.mx) AS mx, ABS(SUM(c.r)) AS m1
  FROM item i LEFT JOIN s ON s.k = i.i_item_sk LEFT JOIN c ON c.k = i.i_item_sk
  GROUP BY ALL
)
SELECT i_color, i_category, i_brand,
  CASE WHEN COALESCE(mn, 0) > COALESCE(mx, 0) THEN mn WHEN COALESCE(mx, 0) > COALESCE(mn, 0) THEN mx ELSE COALESCE(mn, mx) END AS m0,
  m1
FROM t
WHERE mn IS NOT NULL OR mx IS NOT NULL OR m1 IS NOT NULL
