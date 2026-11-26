-- per quarter (a row context): the lowest over the ship mode types of
-- (no catalog quantity at all ? 0 : the quarter's store profit share of its own profit, no item filter: 1)
WITH q AS (
  SELECT d.d_qoy, SUM(ss.ss_net_profit) AS np
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
)
SELECT g.d_qoy,
  CASE WHEN NOT EXISTS (SELECT 1 FROM ship_mode) THEN NULL
       WHEN (SELECT MAX(cs_quantity) FROM catalog_sales) IS NULL THEN 0
       ELSE q.np / NULLIF(q.np, 0) END AS m0
FROM (SELECT DISTINCT d_qoy FROM date_dim) g LEFT JOIN q ON q.d_qoy = g.d_qoy
