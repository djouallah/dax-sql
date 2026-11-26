-- the dates do not filter store: every city counts (a missing city as one more value)
WITH c AS (SELECT COUNT(DISTINCT s_city) + (COUNT(*) > COUNT(s_city))::INT AS n FROM store),
p AS (
  SELECT SUM(cs.cs_net_profit) AS np
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  WHERE d.d_date BETWEEN DATE '2024-06-05' AND DATE '2026-03-31')
SELECT m0 FROM (SELECT NULLIF(c.n, 0)::DOUBLE / NULLIF(p.np, 0) AS m0 FROM c, p) WHERE m0 IS NOT NULL
