-- per quarter (d_qoy) and year: catalog quantity (no brand is selected); the store revenue change over a year
-- for the month before the group's first date (whole months a year apart); and the group's own change over a
-- year (its dates a year back, a month's last day also reaching Feb 29), 0 when it has no store profit
WITH r AS (
  SELECT d.d_date AS dt, SUM(ss.ss_ext_sales_price) AS rev, SUM(ss.ss_net_profit) AS np
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
), c AS (
  SELECT d.d_qoy AS q, d.d_year AS y, SUM(cs.cs_quantity) AS csq
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY ALL
), g AS (
  SELECT d_qoy AS q, d_year AS y, (date_trunc('month', MIN(d_date)) - INTERVAL 1 MONTH)::DATE AS pm FROM date_dim GROUP BY ALL
), ly AS (
  SELECT d_qoy AS q, d_year AS y, (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
  UNION SELECT d_qoy, d_year, last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), cur AS (
  SELECT d.d_qoy AS q, d.d_year AS y, SUM(r.rev) AS rev, SUM(r.np) AS np FROM date_dim d JOIN r ON r.dt = d.d_date GROUP BY ALL
), prev AS (
  SELECT ly.q, ly.y, SUM(r.rev) AS rev FROM ly JOIN r USING (dt) GROUP BY ALL
), pmo AS (
  SELECT g.q, g.y,
    SUM(r.rev) FILTER (WHERE r.dt >= g.pm AND r.dt < g.pm + INTERVAL 1 MONTH) AS rev,
    SUM(r.rev) FILTER (WHERE r.dt >= g.pm - INTERVAL 1 YEAR AND r.dt < g.pm - INTERVAL 1 YEAR + INTERVAL 1 MONTH) AS ly
  FROM g JOIN r ON r.dt >= g.pm - INTERVAL 1 YEAR AND r.dt < g.pm + INTERVAL 1 MONTH
  GROUP BY ALL
)
SELECT g.q, g.y, c.csq AS m0,
  (COALESCE(pmo.rev, 0) - pmo.ly) / NULLIF(pmo.ly, 0) AS m1,
  CASE WHEN cur.np IS NULL THEN 0 ELSE (COALESCE(cur.rev, 0) - prev.rev) / NULLIF(prev.rev, 0) END AS m2
FROM g
LEFT JOIN c USING (q, y) LEFT JOIN cur USING (q, y) LEFT JOIN prev USING (q, y) LEFT JOIN pmo USING (q, y)
