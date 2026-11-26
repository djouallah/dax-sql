-- the year to date of the last date from 2024-04-24 to 2026-08-28: profit share of every item (1 or blank);
-- a blank compares as 0 in a two-argument MAX
WITH last AS (
  SELECT MAX(d_date) AS dt FROM date_dim WHERE d_date BETWEEN DATE '2024-04-24' AND DATE '2026-08-28'
), a AS (
  SELECT SUM(ss.ss_net_profit) / NULLIF(SUM(ss.ss_net_profit), 0) AS x,
    (SELECT COALESCE(SUM(cs_quantity), 0) FROM catalog_sales) AS y
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  JOIN last ON d.d_date BETWEEN date_trunc('year', last.dt)::DATE AND last.dt
)
SELECT CASE WHEN COALESCE(x, 0) > y THEN x WHEN y > COALESCE(x, 0) THEN y ELSE COALESCE(x, y) END AS m0 FROM a
