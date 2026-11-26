-- per year: catalog quantity between Apr 13 2026 and Jun 30 2024 (no dates: blank), and the year's catalog quantity
-- (the blank year, when a sale has no or an unknown date: the quantity of those sales)
SELECT y.d_year, CAST(NULL AS BIGINT) AS m0, q.qty AS m1
FROM (
  SELECT DISTINCT d_year FROM date_dim
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_sold_date_sk IS NULL OR ss_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_sold_date_sk IS NULL OR cs_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
) y
LEFT JOIN (
  SELECT d.d_year, SUM(cs.cs_quantity) AS qty
  FROM catalog_sales cs LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk GROUP BY ALL
) q ON q.d_year IS NOT DISTINCT FROM y.d_year
