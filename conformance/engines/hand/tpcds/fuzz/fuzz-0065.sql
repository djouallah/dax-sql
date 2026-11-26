-- m1: the inner RANKX ranks MAX/MIN of catalog_sales, which no row context changes (no CALCULATE):
-- every ship mode ties at 1, and so does every state: 1
WITH p AS (
  SELECT cd.cd_marital_status, SUM(ss.ss_net_profit) AS v
  FROM store_sales ss
  JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_date BETWEEN DATE '2025-01-15' AND DATE '2026-11-04'
  GROUP BY 1
)
SELECT g.cd_marital_status, p.v, 1
FROM (SELECT DISTINCT cd_marital_status FROM customer_demographics) g
LEFT JOIN p ON p.cd_marital_status IS NOT DISTINCT FROM g.cd_marital_status
