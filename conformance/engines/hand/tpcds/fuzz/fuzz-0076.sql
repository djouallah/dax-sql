-- DATESBETWEEN from a later date to an earlier one is empty: the MAX is the catalog quantity of
-- almond items over the last year, which the store does not filter: every city ties
WITH q AS (
  SELECT SUM(cs.cs_quantity) AS v
  FROM catalog_sales cs
  JOIN item i ON i.i_item_sk = cs.cs_item_sk AND i.i_color = 'almond'
  JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk AND d.d_year = (SELECT MAX(d_year) FROM date_dim)
)
SELECT DISTINCT s.s_city, q.v
FROM store s CROSS JOIN q
WHERE q.v IS NOT NULL
QUALIFY RANK() OVER (ORDER BY q.v DESC) <= 3
