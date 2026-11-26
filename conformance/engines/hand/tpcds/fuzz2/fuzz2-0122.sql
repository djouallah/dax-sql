-- one row: catalog quantity YoY (all quantity against the quantity a year back from every date) - catalog profit,
-- and distinct store customers (no customer counts as one) over the catalog quantity a year back
WITH ly AS (
  SELECT DISTINCT d.d_date_sk_1 AS sk
  FROM (SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
        UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)) x
  JOIN date_dim d ON d.d_date = x.dt
), c AS (
  SELECT SUM(cs_quantity) AS q, SUM(cs_quantity) FILTER (WHERE cs_sold_date_sk IN (SELECT sk FROM ly)) AS ly, SUM(cs_net_profit) AS np
  FROM catalog_sales
), s AS (
  SELECT COUNT(DISTINCT ss_customer_sk) + MAX(CASE WHEN ss_customer_sk IS NULL THEN 1 ELSE 0 END) AS dc FROM store_sales
), r AS (
  SELECT (COALESCE(c.q, 0) - c.ly) / NULLIF(c.ly, 0) AS yoy, c.np, s.dc / NULLIF(c.ly, 0) AS m1 FROM c, s
)
SELECT CASE WHEN yoy IS NULL AND np IS NULL THEN NULL ELSE COALESCE(yoy, 0) - COALESCE(np, 0) END AS m0, m1
FROM r
WHERE m0 IS NOT NULL OR m1 IS NOT NULL
