WITH m AS (
  SELECT d.d_year AS y, d.d_moy AS moy, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_year IN (2024, 2025)
  GROUP BY ALL
)
SELECT g.d_year, g.d_moy, l.rev
FROM (SELECT DISTINCT d_year, d_moy FROM date_dim WHERE d_year IN (2025, 2026)) g
JOIN m l ON l.y = g.d_year - 1 AND l.moy = g.d_moy
WHERE l.rev IS NOT NULL
