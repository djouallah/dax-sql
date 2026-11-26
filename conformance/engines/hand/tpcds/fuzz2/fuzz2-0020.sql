-- per year: catalog quantity between Apr 13 2026 and Jun 30 2024 (no dates: blank), and the year's catalog quantity
SELECT y.d_year, CAST(NULL AS BIGINT) AS m0, q.qty AS m1
FROM (SELECT DISTINCT d_year FROM date_dim) y
LEFT JOIN (
  SELECT d.d_year, SUM(cs.cs_quantity) AS qty
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk GROUP BY ALL
) q ON q.d_year = y.d_year
