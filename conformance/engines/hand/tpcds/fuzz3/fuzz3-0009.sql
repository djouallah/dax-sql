-- per marital status x ship-mode type: all store sales rows (COUNTROWS outside CALCULATE: no
-- context transition) over the marital status's store revenue on the window's dates
-- (2025-10-09 .. 2026-01-08) a year back; ship_mode filters no store sale. Both lists hold their blank row when
-- some sale's key misses the table (a store sale without demographics: the blank status)
WITH win AS (
  SELECT d_date AS dt FROM date_dim WHERE d_date > DATE '2026-01-08' - INTERVAL 3 MONTH AND d_date <= DATE '2026-01-08'
), ly AS (
  SELECT (dt - INTERVAL 1 YEAR)::DATE AS dt FROM win
  UNION SELECT last_day((dt - INTERVAL 1 YEAR)::DATE) FROM win WHERE dt = last_day(dt)
), r AS (
  SELECT cd.cd_marital_status, SUM(ss.ss_ext_sales_price) AS rev_ly
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk JOIN ly ON ly.dt = d.d_date
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  GROUP BY ALL
), m AS (
  SELECT DISTINCT cd_marital_status FROM customer_demographics
  UNION SELECT NULL WHERE EXISTS (FROM store_sales ANTI JOIN customer_demographics ON cd_demo_sk = ss_cdemo_sk)
                       OR EXISTS (FROM catalog_sales ANTI JOIN customer_demographics ON cd_demo_sk = cs_bill_cdemo_sk)
                       OR EXISTS (FROM catalog_sales ANTI JOIN customer_demographics ON cd_demo_sk = cs_ship_cdemo_sk)
), sm AS (
  SELECT DISTINCT sm_type FROM ship_mode
  UNION SELECT NULL WHERE EXISTS (FROM catalog_sales ANTI JOIN ship_mode ON sm_ship_mode_sk = cs_ship_mode_sk)
)
SELECT m.cd_marital_status, sm.sm_type, (SELECT COUNT(*) FROM store_sales) / NULLIF(r.rev_ly, 0) AS m0
FROM m CROSS JOIN sm
LEFT JOIN r ON r.cd_marital_status IS NOT DISTINCT FROM m.cd_marital_status
