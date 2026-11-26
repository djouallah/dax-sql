-- over every date a year back (SAMEPERIODLASTYEAR of all dates), per ship mode type (store sales know none) and
-- quarter: no December store sale in the quarter gives 0, else twice the largest store profit plus the items. The
-- types include the blank row when some catalog sale has no ship mode
WITH d AS (
  SELECT * FROM date_dim WHERE d_date IN (
    SELECT (d_date - INTERVAL 1 YEAR)::DATE FROM date_dim
    UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date))
), s AS (
  SELECT d.d_qoy AS q, AVG(ss.ss_quantity) FILTER (WHERE d.d_moy = 12) AS av, MAX(ss.ss_net_profit) AS mx
  FROM store_sales ss JOIN d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
)
SELECT sm.sm_type, g.d_qoy,
  CASE WHEN s.av IS NULL THEN 0 ELSE COALESCE(s.mx, 0) * 2 + (SELECT COUNT(*) FROM item) END AS m0
FROM (SELECT sm_type FROM ship_mode
      UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM catalog_sales ANTI JOIN ship_mode ON sm_ship_mode_sk = cs_ship_mode_sk)) sm
CROSS JOIN (SELECT DISTINCT d_qoy FROM d) g
LEFT JOIN s ON s.q = g.d_qoy
