-- per marital status x ship-mode type: all store sales rows (COUNTROWS outside CALCULATE: no
-- context transition) over the marital status's store revenue on the window's dates
-- (2025-10-09 .. 2026-01-08) a year back; ship_mode filters no store sale
WITH win AS (
  SELECT d_date AS dt FROM date_dim WHERE d_date > DATE '2026-01-08' - INTERVAL 3 MONTH AND d_date <= DATE '2026-01-08'
), ly AS (
  SELECT (dt - INTERVAL 1 YEAR)::DATE AS dt FROM win
  UNION SELECT last_day((dt - INTERVAL 1 YEAR)::DATE) FROM win WHERE dt = last_day(dt)
), r AS (
  SELECT cd.cd_marital_status, SUM(ss.ss_ext_sales_price) AS rev_ly
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk JOIN ly ON ly.dt = d.d_date
  JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  GROUP BY ALL
)
SELECT m.cd_marital_status, sm.sm_type, (SELECT COUNT(*) FROM store_sales) / NULLIF(r.rev_ly, 0) AS m0
FROM (SELECT DISTINCT cd_marital_status FROM customer_demographics) m
CROSS JOIN (SELECT DISTINCT sm_type FROM ship_mode) sm
LEFT JOIN r ON r.cd_marital_status IS NOT DISTINCT FROM m.cd_marital_status
