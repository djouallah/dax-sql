-- a running sum over 2025's months, from January
WITH m AS (
  SELECT d.d_moy AS moy, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_year = 2025
  GROUP BY ALL
), t AS (
  SELECT g.d_year, g.d_moy, SUM(m.rev) OVER (ORDER BY g.d_moy) AS ytd
  FROM (SELECT DISTINCT d_year, d_moy FROM date_dim WHERE d_year = 2025) g
  LEFT JOIN m ON m.moy = g.d_moy
)
SELECT * FROM t WHERE ytd IS NOT NULL
