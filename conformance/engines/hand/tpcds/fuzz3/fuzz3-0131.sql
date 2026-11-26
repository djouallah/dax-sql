-- one row over every date. Last year: a sale whose date a year on is in the calendar. The archive
-- is related to nothing (the month filter does not reach it); in the SWITCH, Store Profit % by
-- Item Category with no item filter is the profit over itself
WITH s AS (
  SELECT SUM(ss.ss_ext_sales_price) AS rev, SUM(ss.ss_ext_sales_price) FILTER (WHERE n.d_date IS NOT NULL) AS ly,
    SUM(ss.ss_net_profit) AS np, MIN(ss.ss_ext_sales_price) AS mn, MIN(ss.ss_quantity) AS mq,
    ROUND((SUM(ss.ss_net_profit) * 1000000)::HUGEINT // NULLIF(COUNT(ss.ss_net_profit), 0) * 0.000001, 4) AS avp
  FROM store_sales ss
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  LEFT JOIN date_dim n ON n.d_date = (d.d_date + INTERVAL 1 YEAR)::DATE
), c AS (
  SELECT SUM(cs.cs_net_profit) AS np, SUM(cs.cs_quantity) FILTER (WHERE n.d_date IS NOT NULL) AS ly
  FROM catalog_sales cs
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  LEFT JOIN date_dim n ON n.d_date = (d.d_date + INTERVAL 1 YEAR)::DATE
), k AS (
  SELECT (SELECT SUM(row_count) FROM stg_tpcds_archive_log) AS asr,
    (SELECT COUNT(DISTINCT cd_marital_status) + MAX((cd_marital_status IS NULL)::INT) FROM customer_demographics) AS dcm
)
SELECT CASE WHEN COALESCE(s.ly, 0) > 100 THEN
    CASE WHEN COALESCE(k.asr, 0) > 10
      OR (CASE WHEN k.dcm > 1000 THEN s.mq WHEN COALESCE(c.np, 0) < 100 THEN s.np / NULLIF(s.np, 0) ELSE s.avp END) IS NOT NULL
    THEN s.mn ELSE c.ly END
  ELSE CASE WHEN s.np IS NULL AND s.ly IS NULL THEN NULL
    ELSE COALESCE(s.np, 0) - COALESCE((COALESCE(s.rev, 0) - s.ly) / NULLIF(s.ly, 0), 0) END
  END AS m0
FROM s, c, k
