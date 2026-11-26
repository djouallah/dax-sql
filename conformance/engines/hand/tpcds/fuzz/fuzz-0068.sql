-- with no date filter, a year back is every year but the last
WITH c AS (
  SELECT i.i_brand AS b, SUM(cs.cs_quantity) AS v
  FROM catalog_sales cs LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY 1
), s AS (
  SELECT i.i_brand AS b, SUM(ss.ss_ext_sales_price) AS v
  FROM store_sales ss
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  WHERE d.d_year < (SELECT MAX(d_year) FROM date_dim)
  GROUP BY 1
)
SELECT COALESCE(c.b, s.b), c.v, s.v
FROM c FULL JOIN s ON s.b IS NOT DISTINCT FROM c.b
WHERE c.v IS NOT NULL OR s.v IS NOT NULL
