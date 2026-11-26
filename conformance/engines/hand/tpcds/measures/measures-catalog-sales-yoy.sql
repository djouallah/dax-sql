WITH m AS (
  SELECT d.d_year AS y, d.d_moy AS moy, SUM(cs.cs_quantity) AS qty
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk AND d.d_year IN (2025, 2026)
  GROUP BY ALL
), t AS (
  SELECT g.d_year, g.d_moy, (COALESCE(c.qty, 0) - l.qty) / NULLIF(l.qty, 0) AS yoy
  FROM (SELECT DISTINCT d_year, d_moy FROM date_dim WHERE d_year = 2026) g
  LEFT JOIN m c ON c.y = g.d_year AND c.moy = g.d_moy
  JOIN m l ON l.y = g.d_year - 1 AND l.moy = g.d_moy
)
SELECT * FROM t WHERE yoy IS NOT NULL
