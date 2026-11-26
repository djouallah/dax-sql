-- per ship-mode type (sales with no ship mode: blank), items of the first class ascending (a blank
-- class sorts first and also holds sales with no item): catalog YoY on DATEADD(-1 quarter) of
-- every date (each date 3 months back, a month's last day reaching the shifted month's last day)
-- against those dates a year back; absolute; the highest (ties kept)
WITH q AS (
  SELECT (d_date - INTERVAL 3 MONTH)::DATE AS dt FROM date_dim
  UNION SELECT UNNEST(generate_series((d_date - INTERVAL 3 MONTH)::DATE, last_day((d_date - INTERVAL 3 MONTH)::DATE), INTERVAL 1 DAY))::DATE
  FROM date_dim WHERE d_date = last_day(d_date)
), qd AS (
  SELECT d_date AS dt FROM date_dim WHERE d_date IN (SELECT dt FROM q)
), ly AS (
  SELECT (dt - INTERVAL 1 YEAR)::DATE AS dt FROM qd
  UNION SELECT last_day((dt - INTERVAL 1 YEAR)::DATE) FROM qd WHERE dt = last_day(dt)
), cls AS (
  SELECT i_class FROM (SELECT DISTINCT i_class FROM item) ORDER BY i_class NULLS FIRST LIMIT 1
), c AS (
  SELECT sm.sm_type,
         SUM(cs.cs_quantity) FILTER (WHERE d.d_date IN (SELECT dt FROM qd)) AS qty,
         SUM(cs.cs_quantity) FILTER (WHERE d.d_date IN (SELECT dt FROM ly)) AS qty_ly
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  LEFT JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk
  WHERE i.i_class IS NOT DISTINCT FROM (SELECT i_class FROM cls)
  GROUP BY ALL
), y AS (
  SELECT sm_type, abs((COALESCE(qty, 0) - qty_ly) / NULLIF(qty_ly, 0)) AS m0 FROM c
)
SELECT sm_type, m0 FROM y WHERE m0 IS NOT NULL QUALIFY rank() OVER (ORDER BY m0 DESC) <= 1
