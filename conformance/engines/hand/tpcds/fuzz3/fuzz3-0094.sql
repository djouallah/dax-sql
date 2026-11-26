-- the catalog quantity YTD (the last date's year, through it) over all of it; the stores' distinct states
WITH y AS (SELECT MAX(d_date) AS hi FROM date_dim)
SELECT
  (SELECT SUM(cs.cs_quantity) FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
   JOIN y ON d.d_date BETWEEN date_trunc('year', y.hi) AND y.hi)
  / NULLIF(ABS((SELECT SUM(cs_quantity) FROM catalog_sales)), 0) AS m0,
  (SELECT COUNT(DISTINCT s_state) + MAX((s_state IS NULL)::INT) FROM store) AS m1
