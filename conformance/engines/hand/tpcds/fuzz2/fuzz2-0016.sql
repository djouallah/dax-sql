-- per marital status, over the calendar's last year (its year to date): when the stores are one state,
-- archive files / store revenue the year before; the 3 highest, ties kept
WITH w AS (
  SELECT date_trunc('year', MAX(d_date))::DATE AS y0, MAX(d_date) AS y1 FROM date_dim
), ly AS (
  -- that year's dates a year back (a month's last day reaching the 29th of February)
  SELECT DISTINCT l.d_date_sk_1
  FROM date_dim d JOIN w ON d.d_date BETWEEN w.y0 AND w.y1
  JOIN date_dim l ON l.d_date BETWEEN CAST(d.d_date - INTERVAL 1 YEAR AS DATE)
    AND CASE WHEN d.d_date = last_day(d.d_date) THEN last_day(CAST(d.d_date - INTERVAL 1 YEAR AS DATE)) ELSE CAST(d.d_date - INTERVAL 1 YEAR AS DATE) END
), r AS (
  SELECT cd.cd_marital_status, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss JOIN ly ON ly.d_date_sk_1 = ss.ss_sold_date_sk
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  GROUP BY ALL
), v AS (
  -- the statuses with revenue (sales with no demographics: a blank status)
  SELECT r.cd_marital_status, (SELECT COUNT(*) FROM stg_tpcds_archive_log) / NULLIF(r.rev, 0) AS m0
  FROM r
  WHERE (SELECT COUNT(DISTINCT s_state) + MAX(CASE WHEN s_state IS NULL THEN 1 ELSE 0 END) FROM store) = 1
)
SELECT * FROM v WHERE m0 IS NOT NULL
QUALIFY RANK() OVER (ORDER BY m0 DESC) <= 3
