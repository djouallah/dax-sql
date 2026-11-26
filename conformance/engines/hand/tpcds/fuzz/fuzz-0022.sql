-- items of Shoes and Home; the average store price in 2026 (a fixed decimal: the exact sum over the count to 4
-- places) over the catalog quantity of the month and quarter number in any year (DIVIDE of a fixed decimal by a
-- whole number: the exact quotient, half away from zero, to 4 places)
WITH s AS (
  SELECT d.d_moy, d.d_qoy, i.i_class,
    CAST(SUM(ss.ss_ext_sales_price) * 10000 AS HUGEINT) AS sm, NULLIF(COUNT(ss.ss_ext_sales_price), 0) AS n
  FROM store_sales ss
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_year = 2026
  JOIN item i ON i.i_item_sk = ss.ss_item_sk AND i.i_category IN ('Shoes', 'Home')
  GROUP BY ALL
), c AS (
  SELECT d.d_moy, d.d_qoy, i.i_class, SUM(cs.cs_quantity) AS qty
  FROM catalog_sales cs
  JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  JOIN item i ON i.i_item_sk = cs.cs_item_sk AND i.i_category IN ('Shoes', 'Home')
  GROUP BY ALL
), t AS (
  SELECT s.d_moy, s.d_qoy, s.i_class, sign(sm) * ((2 * abs(sm) + n) // (2 * n)) AS a, c.qty
  FROM s JOIN c ON c.d_moy = s.d_moy AND c.d_qoy = s.d_qoy AND c.i_class IS NOT DISTINCT FROM s.i_class
)
SELECT d_moy, d_qoy, i_class, sign(a) * sign(qty) * ((2 * abs(a) + abs(qty)) // NULLIF(2 * abs(qty), 0)) / 10000 AS m0
FROM t
WHERE m0 IS NOT NULL
