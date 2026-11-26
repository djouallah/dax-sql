-- per quarter (d_qoy) and category: the profit share among single/married customers' store sales (over every
-- item) picks between the item count (no measure: every item) (when last year's revenue exists) and the store net profit (when the YTD
-- revenue, from Jan 1 of the quarter's last date's year through it, exists); twice that plus the archive's rows
WITH s AS (
  SELECT d.d_qoy AS q, i.i_category AS cat, d.d_date AS dt, cd.cd_marital_status AS ms,
    SUM(ss.ss_ext_sales_price) AS rev, SUM(ss.ss_net_profit) AS np
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  GROUP BY ALL
), g AS (
  SELECT q.d_qoy, c.i_category, q.hi
  FROM (SELECT d_qoy, MAX(d_date) AS hi FROM date_dim GROUP BY ALL) q, (SELECT DISTINCT i_category FROM item) c
), ly AS (
  SELECT d_qoy, (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim
  UNION SELECT d_qoy, last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), den AS (
  SELECT q, SUM(np) AS np FROM s WHERE ms IN ('S', 'M') GROUP BY ALL
), t AS (
  SELECT g.d_qoy, g.i_category,
    (SELECT SUM(np) FROM s WHERE s.q = g.d_qoy AND s.cat IS NOT DISTINCT FROM g.i_category AND s.ms IN ('S', 'M'))
      / NULLIF((SELECT np FROM den WHERE den.q = g.d_qoy), 0) AS pct,
    (SELECT SUM(rev) FROM s JOIN ly ON ly.ly = s.dt AND ly.d_qoy = g.d_qoy WHERE s.cat IS NOT DISTINCT FROM g.i_category) AS sply,
    (SELECT COUNT(*) FROM item) AS items,
    (SELECT SUM(rev) FROM s WHERE s.cat IS NOT DISTINCT FROM g.i_category AND s.dt BETWEEN date_trunc('year', g.hi) AND g.hi) AS ytd,
    (SELECT SUM(np) FROM s WHERE s.q = g.d_qoy AND s.cat IS NOT DISTINCT FROM g.i_category) AS np
  FROM g
)
SELECT d_qoy, i_category,
  COALESCE(CASE WHEN pct > 100 THEN CASE WHEN sply IS NULL THEN 0 ELSE items END
    ELSE CASE WHEN ytd IS NULL THEN 0 ELSE np END END, 0) * 2
  + COALESCE(ROUND((SELECT SUM(row_count) FROM stg_tpcds_archive_log), 1), 0) AS m0
FROM t
